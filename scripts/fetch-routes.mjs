// Fetches the tunnelbana's ROUTE RELATIONS from OpenStreetMap and writes
// data/routes.json.
//
// A route relation is one service in one direction, "Tunnelbana 17: Åkeshov →
// Skarpnäck", and its members are the stops and platforms it calls at, in
// order, followed by the track ways it runs on. That ordering is the one thing
// platform polygons cannot tell us: WHICH platform a given line uses at a given
// station, and which way the train on it is pointing.
//
// Two things in the game need it:
//   - Gamla stan and Slussen pair their platforms by DIRECTION, not by line:
//     one island takes green and red northbound, the other takes both
//     southbound. Every other interchange pairs by line. Nothing in the
//     platform geometry distinguishes those two arrangements.
//   - Per-line centrelines at interchanges: today every island at a station
//     shares one curve, because we cannot yet say which track belongs to which
//     line.
//
// The whole network is a few dozen relations, so this is ONE query rather than
// the batched crawl fetch-platforms.mjs has to do for geometry.
//
//   node --experimental-strip-types scripts/fetch-routes.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { writeFileSync, mkdirSync } from 'node:fs';

const BBOX = '59.20,17.75,59.45,18.25';
const RETRY_MS = [5000, 15000, 30000, 60000];

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

// The relations, plus the stop/platform members resolved far enough to name
// them: a stop is a node ON the track, a platform is the way or relation
// beside it, and we want both because different lines are mapped differently.
const query = `[out:json][timeout:300];
relation["type"="route"]["route"="subway"](${BBOX}) -> .r;
.r out body;
node(r.r:"stop")->.s;
node(r.r:"stop_entry_only")->.s2;
node(r.r:"stop_exit_only")->.s3;
(.s; .s2; .s3;);
out body;
(
  node(r.r:"platform"); node(r.r:"platform_entry_only"); node(r.r:"platform_exit_only");
  way(r.r:"platform"); way(r.r:"platform_entry_only"); way(r.r:"platform_exit_only");
  relation(r.r:"platform"); relation(r.r:"platform_entry_only"); relation(r.r:"platform_exit_only");
);
out geom;`;

process.stdout.write('fetching subway route relations… ');
const json = await overpass(query);

// platform members can be relations too, so the route relations are the ones
// that say they are routes
const relations = json.elements.filter((e) => e.type === 'relation' && e.tags?.type === 'route');
// stops are kept WITH their position: a stop node sits on the track, so which
// platform a service uses is settled by which platform polygon it stands next
// to, and nothing else in the relation says it
const nodes = new Map(
  json.elements
    .filter((e) => e.type === 'node')
    .map((e) => [e.id, { tags: e.tags ?? {}, lat: e.lat, lon: e.lon }]),
);
// and the platform members themselves, WITH their tags and a position. The
// tags are what settle a stacked station: a platform carries the storey it is
// on, so a member we cannot match by id can still be matched to the right
// LEVEL, which is the one thing proximity cannot do when three platforms are
// drawn on top of each other in plan view.
const centroid = (e) => {
  const g = e.geometry ?? (e.members ?? []).flatMap((m) => m.geometry ?? []);
  const pts = g.filter((n) => n && n.lat !== undefined);
  if (pts.length === 0) return e.lat !== undefined ? { lat: e.lat, lon: e.lon } : {};
  return {
    lat: pts.reduce((a, n) => a + n.lat, 0) / pts.length,
    lon: pts.reduce((a, n) => a + n.lon, 0) / pts.length,
  };
};
const memberEls = new Map();
for (const e of json.elements) {
  if (e.type === 'relation' && e.tags?.type === 'route') continue;
  memberEls.set(`${e.type}/${e.id}`, { tags: e.tags ?? {}, ...centroid(e) });
}
const _ways = new Map(json.elements.filter((e) => e.type === 'way').map((e) => [e.id, e.tags ?? {}]));
console.log(`${relations.length} relations, ${nodes.size} stops, ${memberEls.size} resolved members`);

const infoOfMember = (m) => {
  if (m.type === 'node') {
    const n = nodes.get(m.ref);
    return n ? { name: n.tags.name ?? null, lat: n.lat, lon: n.lon } : { name: null };
  }
  const el = memberEls.get(`${m.type}/${m.ref}`);
  if (!el) return { name: null };
  return { name: el.tags.name ?? null, lat: el.lat, lon: el.lon, tags: el.tags };
};

const out = {
  source: 'OpenStreetMap via Overpass, ODbL',
  fetched: new Date().toISOString(),
  routes: relations.map((r) => ({
    osmId: r.id,
    // ref is the line number (17, 14, 10…), colour the line, from/to the
    // direction this particular relation runs
    ref: r.tags?.ref ?? null,
    name: r.tags?.name ?? null,
    colour: r.tags?.colour ?? r.tags?.color ?? null,
    from: r.tags?.from ?? null,
    to: r.tags?.to ?? null,
    // every member in order: the calls first (stop/platform roles), then the
    // track ways with an empty role
    calls: (r.members ?? [])
      .filter((m) => /^(stop|platform)/.test(m.role ?? ''))
      .map((m) => ({ type: m.type, ref: m.ref, role: m.role, ...infoOfMember(m) })),
    trackWays: (r.members ?? []).filter((m) => m.type === 'way' && !m.role).map((m) => m.ref),
  })),
};

mkdirSync('data', { recursive: true });
writeFileSync('data/routes.json', JSON.stringify(out, null, 1));

const named = out.routes.filter((r) => r.ref);
console.log(`\n${out.routes.length} routes written, ${named.length} with a line ref`);
for (const r of out.routes.slice(0, 40)) {
  console.log(
    `  ${String(r.ref ?? '?').padStart(3)} ${String(r.from ?? '?')
      .slice(0, 18)
      .padEnd(18)} → ` +
      `${String(r.to ?? '?')
        .slice(0, 18)
        .padEnd(18)} ${r.calls.length} calls, ${r.trackWays.length} ways`,
  );
}
