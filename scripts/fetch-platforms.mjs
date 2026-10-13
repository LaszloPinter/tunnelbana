// Fetches real platform geometry for EVERY station in the network from
// OpenStreetMap (Overpass API) and writes data/platforms.json.
//
// For every station: the subway station node, every mapped platform within
// 150m, as ways AND as relations, because a good number of tunnelbana
// platforms are mapped as multipolygon relations rather than closed ways
// (Gubbängen and Rådmansgatan were the misses that made this necessary), and
// the subway TRACKS through the station. The tracks matter more than the
// platforms for the curved-platform work: a platform polygon is missing or
// fragmentary at a fair number of stations, while the track alignment is
// mapped everywhere and is the curve the platform follows.
// Geometry is converted to metres relative to the station node (x east,
// y north), and each platform gets a PCA principal axis so the game can derive
// centreline, width and curvature. Raw points are kept, the swept-path work
// decides how to consume them.
//
// The station list comes from src/core/network.ts, so the network graph stays
// the single source of truth. Run with:
//   node --experimental-strip-types scripts/fetch-platforms.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { writeFileSync, mkdirSync } from 'node:fs';
import { ALL_STATIONS } from '../src/core/network.ts';

/** OSM spells a few of these differently from the network graph */
const ALIASES = {
  'S:t Eriksplan': ['S:t Eriksplan', 'Sankt Eriksplan'],
};

/** the whole network fits in here, Norsborg and Hässelby included */
const BBOX = '59.20,17.75,59.45,18.25';
/** Overpass is a shared public service: small batches, and back off when it
 * says it is busy. Track ways carry a lot of geometry, so 10 is about the
 * largest batch it will serve without a 504. */
const BATCH = 10;
const PAUSE_MS = 3000;
const RETRY_MS = [5000, 15000, 30000, 60000];

const namesFor = (n) => ALIASES[n] ?? [n];
const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const overpass = async (query) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'tunnelbana/0.2 (hobby game; https://teacentralen.com)',
        Accept: 'application/json',
      },
      body: 'data=' + encodeURIComponent(query),
    });
    if (res.ok) return res.json();
    const retriable = res.status === 429 || res.status === 504 || res.status >= 500;
    if (!retriable || attempt >= RETRY_MS.length) {
      throw new Error(`overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const wait = Number(res.headers.get('retry-after')) * 1000 || RETRY_MS[attempt];
    process.stdout.write(`(${res.status}, retrying in ${Math.round(wait / 1000)}s) `);
    await res.text();
    await sleep(wait);
  }
};

const toLocal = (lat, lon, lat0, lon0) => {
  const x = (lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180);
  const y = (lat - lat0) * 110540;
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
};

const distM = (aLat, aLon, bLat, bLon) => {
  const [x, y] = toLocal(aLat, aLon, bLat, bLon);
  return Math.hypot(x, y);
};

/** principal axis of a point cloud: length along it, width across it */
const pca = (pts) => {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0,
    sxy = 0,
    syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  let minA = Infinity,
    maxA = -Infinity,
    minB = Infinity,
    maxB = -Infinity;
  for (const [x, y] of pts) {
    const a = (x - mx) * ca + (y - my) * sa;
    const b = -(x - mx) * sa + (y - my) * ca;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }
  return {
    angleDeg: Math.round(((angle * 180) / Math.PI) * 10) / 10,
    lengthM: Math.round((maxA - minA) * 10) / 10,
    widthM: Math.round((maxB - minB) * 10) / 10,
  };
};

/** every point of a way, or of every way member of a relation */
const geometryOf = (el) => {
  if (el.type === 'way') return el.geometry ?? [];
  if (el.type === 'relation') {
    return (el.members ?? []).filter((m) => m.type === 'way' && m.geometry).flatMap((m) => m.geometry);
  }
  return [];
};

const isPlatform = (el) => el.tags?.railway === 'platform' || el.tags?.public_transport === 'platform';

const isTrack = (el) => el.type === 'way' && el.tags?.railway === 'subway';

/** the run of a track that passes this station, in metres, station-relative */
const TRACK_KEEP_M = 170;

const batches = [];
for (let i = 0; i < ALL_STATIONS.length; i += BATCH) {
  batches.push(ALL_STATIONS.slice(i, i + BATCH));
}

const stationNodes = [];
const platformEls = [];
const trackEls = [];

for (let b = 0; b < batches.length; b++) {
  const names = batches[b].flatMap(namesFor);
  const nameRe = `^(${names.map(esc).join('|')})$`;
  const query = `[out:json][timeout:300];
(
  node["railway"="station"]["station"="subway"]["name"~"${nameRe}"](${BBOX});
) -> .st;
(
  way["railway"="platform"](around.st:150);
  way["public_transport"="platform"](around.st:150);
  relation["railway"="platform"](around.st:150);
  relation["public_transport"="platform"](around.st:150);
  way["railway"="subway"](around.st:150);
);
out geom;
.st out;`;

  process.stdout.write(`batch ${b + 1}/${batches.length} (${batches[b].length} stations)… `);
  const json = await overpass(query);
  const nodes = json.elements.filter((e) => e.type === 'node' && e.tags?.railway === 'station');
  const plats = json.elements.filter((e) => e.type !== 'node' && isPlatform(e));
  const tracks = json.elements.filter(isTrack);
  stationNodes.push(...nodes);
  platformEls.push(...plats);
  trackEls.push(...tracks);
  console.log(`${nodes.length} stations, ${plats.length} platforms, ${tracks.length} tracks`);
  if (b < batches.length - 1) await sleep(PAUSE_MS);
}

const out = {
  source: 'OpenStreetMap via Overpass, ODbL',
  fetched: new Date().toISOString(),
  stations: [],
};

for (const name of ALL_STATIONS) {
  const names = namesFor(name);
  const cands = stationNodes.filter((s) => names.includes(s.tags.name));
  if (cands.length === 0) {
    out.stations.push({ name, error: 'station node not found' });
    continue;
  }
  // prefer the SL/T-bana node when several share a name
  const st = cands.find((s) => s.tags.network?.includes('SL')) ?? cands[0];
  const near = platformEls
    .filter((p) => {
      const g = geometryOf(p);
      if (g.length === 0) return false;
      const c = g[Math.floor(g.length / 2)];
      return distM(c.lat, c.lon, st.lat, st.lon) < 150;
    })
    // the same platform can come back in more than one batch
    .filter((p, i, arr) => arr.findIndex((q) => q.type === p.type && q.id === p.id) === i)
    .map((p) => {
      const g = geometryOf(p);
      const pts = g.map((n) => toLocal(n.lat, n.lon, st.lat, st.lon));
      return {
        osmId: p.id,
        osmType: p.type,
        closed: p.type === 'way' && p.nodes?.[0] === p.nodes?.[p.nodes.length - 1],
        tags: p.tags,
        ...pca(pts),
        points: pts,
      };
    });
  // the tracks through here, clipped to the station's neighbourhood: this is
  // the curve the platform follows, and it is mapped even where the platform
  // is not
  const tracks = trackEls
    .filter((t, i, arr) => arr.findIndex((q) => q.id === t.id) === i)
    .map((t) => {
      const pts = (t.geometry ?? [])
        .map((n) => toLocal(n.lat, n.lon, st.lat, st.lon))
        .filter(([x, y]) => Math.hypot(x, y) < TRACK_KEEP_M);
      return { osmId: t.id, tags: t.tags, points: pts };
    })
    .filter((t) => t.points.length >= 2);
  out.stations.push({ name, lat: st.lat, lon: st.lon, platforms: near, tracks });
}

mkdirSync('data', { recursive: true });
writeFileSync('data/platforms.json', JSON.stringify(out, null, 1));

let found = 0;
let withTracks = 0;
const missing = [];
for (const s of out.stations) {
  const usable = (s.platforms ?? []).filter((p) => p.lengthM >= 60);
  if ((s.tracks ?? []).length > 0) withTracks += 1;
  if (s.error || usable.length === 0) missing.push(`${s.name} (${s.error ?? 'no platform ≥60m'})`);
  else found += 1;
}
console.log(`\n${found}/${out.stations.length} stations with a usable platform polygon`);
console.log(`${withTracks}/${out.stations.length} stations with track geometry (the centreline source)`);
if (missing.length) console.log(`no platform polygon:\n  ${missing.join('\n  ')}`);
