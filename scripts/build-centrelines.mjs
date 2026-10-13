// Distils the raw OSM platform outlines in data/platforms.json into the shape
// the game actually needs: for every station, a CENTRELINE expressed in
// platform-local coordinates, x along the platform from its centre, y across
// it, plus a width profile.
//
// Straight is the trivial case: every offset is zero. That is the whole point
// of the abstraction, the game can adopt swept-path geometry without any
// station changing shape until we let it.
//
// Method: take the platform polygon, resample its ring every ~1.5m (OSM
// rectangles have four vertices, which no amount of binning will slice), rotate
// into the polygon's principal axis, then walk the length in N slices and take
// the mid-point and spread of the outline in each. Where a station has no
// mapped polygon, the subway track through it supplies the curve and the
// default dimensions apply.
//
// It also writes data/legs.json: for every pair of adjacent stations, how much
// the line TURNS between them, taken from the difference between the two
// platforms' real bearings. That is what tells the game which rides should
// sweep and which should run straight.
//
// Run with: node --experimental-strip-types scripts/build-centrelines.mjs
//
// Data © OpenStreetMap contributors, ODbL.

import { readFileSync, writeFileSync } from 'node:fs';
import { SERVICES } from '../src/core/network.ts';

const raw = JSON.parse(readFileSync('data/platforms.json', 'utf8'));

/** how many samples along the platform; 17 gives ~9m spacing on a 145m platform */
const SAMPLES = 17;
const RESAMPLE_M = 1.5;
/** a tunnelbana platform is about this long, and nothing sane is outside these */
const TYPICAL_M = 145;
/** the shortest polygon worth considering as a platform at all */
const MIN_LEN = 60;
/** but a platform the network can actually use has to take a full 140m train,
 * so anything measuring shorter is a partly-mapped outline, not a short
 * platform, Bandhagen came back as 86m and Medborgarplatsen as 107m */
const MIN_PLATFORM = 141;
const MAX_LEN = 185;
/**
 * The width of an ISLAND, a platform a train stops either side of.
 *
 * Only closed polygons are measured at all: a platform mapped as a line has no
 * width to read. Even then, plenty of stations are built as two SIDE platforms
 * with the tracks between them, and those measure 5-6m each; the game draws
 * every station as an island, so a measurement that narrow is describing a
 * different building than the one being rendered. The floor keeps those
 * playable as narrow islands until side platforms are modelled properly (§4).
 */
const MIN_W = 8.5;
const MAX_W = 17;
const DEFAULT = { lengthM: 145, widthM: 10 };

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** walk a polyline (optionally closed) putting a point every step metres */
const resample = (pts, closed, step = RESAMPLE_M) => {
  const ring = closed && dist(pts[0], pts[pts.length - 1]) > 0.01 ? [...pts, pts[0]] : pts;
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const d = dist(a, b);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
};

/** principal axis angle of a point cloud */
const axisOf = (pts) => {
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
  return { angle: 0.5 * Math.atan2(2 * sxy, sxx - syy), mx, my };
};

/** rotate into (along, across) about the cloud's own centre */
const project = (pts) => {
  const { angle, mx, my } = axisOf(pts);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const local = pts.map(([x, y]) => [(x - mx) * ca + (y - my) * sa, -(x - mx) * sa + (y - my) * ca]);
  return { local, angle };
};

/**
 * Slice a projected outline along its length: the mid-point of each slice is a
 * centreline sample, the spread is the width there.
 */
const profileOf = (local) => {
  const along = local.map((p) => p[0]);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  const len = hi - lo;
  const bins = Array.from({ length: SAMPLES }, () => []);
  for (const [a, b] of local) {
    const t = (a - lo) / (len || 1);
    const i = Math.min(SAMPLES - 1, Math.max(0, Math.round(t * (SAMPLES - 1))));
    bins[i].push(b);
  }
  const mid = [];
  const width = [];
  for (const bin of bins) {
    if (bin.length === 0) {
      mid.push(null);
      width.push(null);
      continue;
    }
    const min = Math.min(...bin);
    const max = Math.max(...bin);
    mid.push((min + max) / 2);
    width.push(max - min);
  }
  // fill any gap by interpolating between the neighbours that do have samples
  const fill = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null) continue;
      let p = i - 1;
      while (p >= 0 && arr[p] === null) p--;
      let n = i + 1;
      while (n < arr.length && arr[n] === null) n++;
      if (p < 0 && n >= arr.length) arr[i] = 0;
      else if (p < 0) arr[i] = arr[n];
      else if (n >= arr.length) arr[i] = arr[p];
      else arr[i] = arr[p] + ((arr[n] - arr[p]) * (i - p)) / (n - p);
    }
    return arr;
  };
  return { mid: fill(mid), width: fill(width), lengthM: len };
};

/** the platform most likely to be THE tunnelbana platform here */
const pickPlatform = (station) => {
  const cands = (station.platforms ?? []).filter((p) => p.lengthM >= MIN_LEN);
  if (cands.length === 0) return null;
  return cands.reduce((best, p) =>
    Math.abs(p.lengthM - TYPICAL_M) < Math.abs(best.lengthM - TYPICAL_M) ? p : best,
  );
};

/** the track that best runs through this station, clipped to platform length */
const pickTrack = (station, lengthM) => {
  const half = lengthM / 2;
  let best = null;
  let bestSpan = 0;
  for (const t of station.tracks ?? []) {
    // only the run that could lie alongside a platform: near the station node
    const near = t.points.filter(([x, y]) => Math.hypot(x, y) <= half);
    if (near.length < 2) continue;
    const span = dist(near[0], near[near.length - 1]);
    if (span > bestSpan) {
      bestSpan = span;
      best = near;
    }
  }
  return best;
};

const round = (v, p = 2) => Math.round(v * 10 ** p) / 10 ** p;

const out = {
  source: 'OpenStreetMap via Overpass, ODbL: distilled by scripts/build-centrelines.mjs',
  built: new Date().toISOString(),
  samples: SAMPLES,
  note:
    'offsets and widths are metres, sampled evenly along the platform; ' +
    'offsets are across-platform displacement from the chord between the ends, ' +
    'so an all-zero offsets array is a straight platform',
  stations: {},
};

let fromPolygon = 0;
let fromTrack = 0;
let fromDefault = 0;
const bows = [];

for (const st of raw.stations) {
  const plat = st.error ? null : pickPlatform(st);
  let lengthM = DEFAULT.lengthM;
  let widthM = DEFAULT.widthM;
  let offsets = new Array(SAMPLES).fill(0);
  let widths = null;
  let source = 'default';

  if (plat) {
    const pts = resample(plat.points, plat.closed !== false);
    const { local } = project(pts);
    const prof = profileOf(local);
    lengthM = Math.min(MAX_LEN, Math.max(MIN_PLATFORM, prof.lengthM));
    // the chord runs between the first and last centreline sample: subtract it
    // so a straight platform is all zeros regardless of how it sits on the map
    const a0 = prof.mid[0];
    const a1 = prof.mid[prof.mid.length - 1];
    offsets = prof.mid.map((m, i) => m - (a0 + ((a1 - a0) * i) / (SAMPLES - 1)));
    widths = prof.width;
    // an unclosed way is a line down the platform, not its outline: it has no
    // width worth reading, so take the network's typical island instead
    widthM = plat.closed ? Math.min(MAX_W, Math.max(MIN_W, median(prof.width))) : DEFAULT.widthM;
    source = 'polygon';
    fromPolygon += 1;
  } else {
    const track = pickTrack(st, DEFAULT.lengthM);
    if (track) {
      const dense = resample(track, false);
      const { local } = project(dense);
      local.sort((a, b) => a[0] - b[0]);
      const lo = local[0][0];
      const hi = local[local.length - 1][0];
      const span = hi - lo;
      offsets = Array.from({ length: SAMPLES }, (_, i) => {
        const a = lo + (span * i) / (SAMPLES - 1);
        // nearest sample's across-offset
        let bestI = 0;
        let bestD = Infinity;
        for (let k = 0; k < local.length; k++) {
          const d = Math.abs(local[k][0] - a);
          if (d < bestD) {
            bestD = d;
            bestI = k;
          }
        }
        return local[bestI][1];
      });
      const b0 = offsets[0];
      const b1 = offsets[SAMPLES - 1];
      offsets = offsets.map((m, i) => m - (b0 + ((b1 - b0) * i) / (SAMPLES - 1)));
      source = 'track';
      fromTrack += 1;
    } else {
      fromDefault += 1;
    }
  }

  const bow = Math.max(...offsets.map(Math.abs));
  bows.push([bow, st.name, source]);
  out.stations[st.name] = {
    lengthM: round(lengthM, 1),
    widthM: round(widthM, 1),
    bowM: round(bow, 2),
    source,
    offsets: offsets.map((v) => round(v)),
    ...(widths ? { widths: widths.map((v) => round(Math.min(MAX_W, Math.max(MIN_W, v)), 1)) } : {}),
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

bows.sort((a, b) => b[0] - a[0]);
console.log(`${Object.keys(out.stations).length} stations written to data/centrelines.json`);
console.log(`  ${fromPolygon} from a mapped platform polygon`);
console.log(`  ${fromTrack} from the track through the station`);
console.log(`  ${fromDefault} straight default (nothing mapped)`);
console.log('\ncurviest platforms, bow across the platform:');
for (const [bow, name, src] of bows.slice(0, 12)) {
  console.log(`  ${name.padEnd(20)} ${bow.toFixed(1).padStart(5)} m   (${src})`);
}
const flat = bows.filter((b) => b[0] < 0.5).length;
console.log(
  `\n${flat}/${bows.length} platforms are flat within 0.5m; ${bows.filter((b) => b[0] >= 2).length} bow 2m or more`,
);

// ------------------------------------------------------- daylight ----
// Which stations stand in the open, and which stretches of track between them
// do. OSM tags the subway ways with tunnel=yes where they run underground, so
// this is real rather than a hand-kept list, and it can answer it PER SIDE of
// a station, which is what the Gamla stan case needs: open toward Slussen,
// diving toward T-Centralen.

const unit = (deg) => {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};

/** how tunnelled the track is on one side of a station, 0..1 */
const tunnelOnSide = (station, axisDeg, sidePlus, halfLenM) => {
  const [ax, ay] = unit(axisDeg);
  let tun = 0;
  let open = 0;
  for (const t of station.tracks ?? []) {
    const isTunnel = !!(t.tags ?? {}).tunnel;
    for (const [x, y] of t.points) {
      const along = x * ax + y * ay;
      // only the run beyond the platform end on the side we are asking about
      if (sidePlus ? along < halfLenM : along > -halfLenM) continue;
      if (isTunnel) tun += 1;
      else open += 1;
    }
  }
  if (tun + open === 0) return null;
  return tun / (tun + open);
};

// ---------------------------------------------------------------- legs ----
// How much does the line turn between two adjacent stations? Their platforms
// are straight-ish pieces of the alignment, so the change in platform bearing
// across a leg is the heading change across it, real data, no guessing, and
// it needs nothing OSM does not already give us.

/** the bearing of the platform we picked for each station, and where it is */
const bearings = new Map();
for (const st of raw.stations) {
  const plat = st.error ? null : pickPlatform(st);
  if (!plat || st.lat === undefined) continue;
  bearings.set(st.name, { angle: plat.angleDeg, lat: st.lat, lon: st.lon });
}

/** platform bearings are axes, not directions: fold into (-90, 90] */
const foldTurn = (deg) => {
  const d = (((deg % 180) + 270) % 180) - 90;
  return Math.abs(d + 90) < 1e-9 ? 90 : d;
};

const metresBetween = (a, b) => {
  const x = (b.lon - a.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 110540;
  return Math.hypot(x, y);
};

const byName = new Map(raw.stations.map((s) => [s.name, s]));

/** does the platform's +axis end point toward this neighbour? */
const axisFacing = (from, to) => {
  const [ax, ay] = unit(from.angle);
  const dx = (to.lon - from.lon) * 111320 * Math.cos((from.lat * Math.PI) / 180);
  const dy = (to.lat - from.lat) * 110540;
  return dx * ax + dy * ay >= 0;
};

const legs = {};
for (const svc of SERVICES) {
  for (let i = 0; i < svc.stations.length - 1; i++) {
    const a = svc.stations[i];
    const b = svc.stations[i + 1];
    const ba = bearings.get(a);
    const bb = bearings.get(b);
    if (!ba || !bb) continue;
    const turnDeg = round(foldTurn(bb.angle - ba.angle), 1);
    const distM = Math.round(metresBetween(ba, bb));
    // how covered the track is leaving each end toward the other
    const halfA = (out.stations[a]?.lengthM ?? 145) / 2;
    const halfB = (out.stations[b]?.lengthM ?? 145) / 2;
    const tunA = tunnelOnSide(byName.get(a), ba.angle, axisFacing(ba, bb), halfA);
    const tunB = tunnelOnSide(byName.get(b), bb.angle, axisFacing(bb, ba), halfB);
    const pair = {
      turnDeg,
      distM,
      /** 0 = open sky at that end, 1 = in tunnel */
      coverA: tunA === null ? null : round(tunA, 2),
      coverB: tunB === null ? null : round(tunB, 2),
    };
    legs[`${a}|${b}`] = pair;
    legs[`${b}|${a}`] = { ...pair, turnDeg: -turnDeg, coverA: pair.coverB, coverB: pair.coverA };
  }
}

// Two things the tags cannot settle on their own. Gamla stan reads as covered
// because the tunnel mouths at both ends fall inside the window, but it is the
// open-air station on the viaduct. And the blue line is deep-bored end to end,
// where OSM leaves a way untagged there, untagged does not mean daylight.
const FORCE_OUTDOOR = new Set(['Gamla stan']);
const blueOnly = new Set();
for (const svc of SERVICES) {
  for (const st of svc.stations) {
    if (svc.color === 'blue') blueOnly.add(st);
  }
}
for (const svc of SERVICES) {
  if (svc.color === 'blue') continue;
  for (const st of svc.stations) blueOnly.delete(st);
}

// and the station itself: are the tracks alongside the platform covered?
for (const [name, st] of Object.entries(out.stations)) {
  const s0 = byName.get(name);
  const bear = bearings.get(name);
  let cover = null;
  if (s0 && bear) {
    // weigh by track POINTS alongside the platform, not by ways: a way that
    // only just reaches the platform end, the tunnel mouth, should not decide
    // whether the station itself is under a roof
    let tun = 0;
    let open = 0;
    for (const t of s0.tracks ?? []) {
      const isTunnel = !!(t.tags ?? {}).tunnel;
      for (const [x, y] of t.points) {
        if (Math.hypot(x, y) > st.lengthM / 2) continue;
        if (isTunnel) tun += 1;
        else open += 1;
      }
    }
    if (tun + open > 0) cover = round(tun / (tun + open), 2);
  }
  st.cover = cover;
  st.outdoor = FORCE_OUTDOOR.has(name) ? true : blueOnly.has(name) ? false : cover !== null && cover < 0.5;
}

writeFileSync(
  'data/legs.json',
  JSON.stringify(
    {
      source: 'OpenStreetMap via Overpass, ODbL: platform bearings differenced per leg',
      built: out.built,
      note:
        'turnDeg is how far the line swings between the two platforms, from their ' +
        'real bearings; sign is the direction of the swing, distM is the straight-line gap',
      legs,
    },
    null,
    1,
  ),
);

const uniq = Object.entries(legs)
  .filter(([k]) => k < k.split('|').reverse().join('|'))
  .sort((x, y) => Math.abs(y[1].turnDeg) - Math.abs(x[1].turnDeg));
console.log(`\n${uniq.length} legs written to data/legs.json`);
console.log('the ones that turn the most:');
for (const [k, v] of uniq.slice(0, 12)) {
  console.log(`  ${k.replace('|', ' → ').padEnd(38)} ${String(v.turnDeg).padStart(6)}°  over ${v.distM} m`);
}
const straightish = uniq.filter(([, v]) => Math.abs(v.turnDeg) < 5).length;
console.log(`${straightish}/${uniq.length} legs turn less than 5°`);
const outdoorStations = Object.entries(out.stations)
  .filter(([, s]) => s.outdoor)
  .map(([n]) => n);
writeFileSync('data/centrelines.json', JSON.stringify(out, null, 1));

console.log(`\n${outdoorStations.length}/100 stations stand in the open (from OSM tunnel tags)`);
const mixed = uniq.filter(
  ([, v]) => v.coverA !== null && v.coverB !== null && Math.abs(v.coverA - v.coverB) > 0.5,
);
console.log(
  `${mixed.length} legs dive on the way: ${mixed
    .slice(0, 6)
    .map(([k]) => k.replace('|', '→'))
    .join(', ')}`,
);
