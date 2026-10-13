// THE ONE WORLD'S LAYOUT, solved offline and committed as data.
//
//   node --experimental-strip-types scripts/gen/worldLayout.ts
//
// The game is one continuous plane: every station a full-scale arena at a
// fixed position and bearing, every leg a real corridor joining two platform
// ends. A raw geographic projection cannot carry that, at LEG_SCALE the
// closest stations sit nearer than their own full-scale platforms are long,
// so the platforms would overlap, and a graph walk cannot either, because
// the network has cycles and independent edge lengths do not close them.
//
// So the layout is SOLVED: stress majorization over the adjacency graph,
// where each leg wants a centre-to-centre distance of
//
//   halfPlatformA + halfPlatformB + LEG_SCALE * (real distance - halves)
//
// (full-scale platforms, playable tunnels, the game's LEG_SCALE, applied
// to the part of a leg that IS tunnel), with a weak
// pull toward the true geography so the map stays recognisably Stockholm,
// and a separation pass so no two stations' arenas overlap. The result is a
// consistent Euclidean world: cycles close, both ends of every leg agree,
// and nothing needs squeezing at draw time.
//
// A station's axis is the direction its dir = +1 trains leave, derived from
// the SOLVED geometry (mean of the directions to its neighbours, signed by
// departure direction), so every leg leaves a platform end along the
// platform itself.

import { writeFileSync } from 'node:fs';
import raw from '../../data/platforms.json' with { type: 'json' };
import { ALL_STATIONS, departuresFrom } from '../../src/core/network.ts';
import { legBetween } from '../../src/data/legGeometry.ts';
import { stationGeo } from '../../src/data/stationGeometry.ts';
import * as C from '../../src/config.ts';

const PX_PER_M = C.PX_PER_M;
const M = (m: number) => m * PX_PER_M;
/** the game's own, so the solved layout and the timetable can never disagree */
const LEG_SCALE = C.LEG_SCALE;
/** the shortest tunnel a leg may have, so every leg is a place you can be */
const MIN_TUNNEL = M(70);

interface RawStation {
  name: string;
  lat: number;
  lon: number;
}
const geoByName = new Map<string, RawStation>();
for (const s of (raw as { stations: RawStation[] }).stations) {
  if (typeof s.lat === 'number' && typeof s.lon === 'number') geoByName.set(s.name, s);
}

const names = ALL_STATIONS.filter((n) => geoByName.has(n));
const idx = new Map(names.map((n, i) => [n, i]));
const halfLen = names.map((n) => M(stationGeo(n).lengthM) / 2);

// ---- the projection, as the geographic prior ----
const M_PER_DEG_LAT = 111_132;
const lat0 = names.reduce((a, n) => a + geoByName.get(n)!.lat, 0) / names.length;
const lon0 = names.reduce((a, n) => a + geoByName.get(n)!.lon, 0) / names.length;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
const proj = names.map((n) => {
  const s = geoByName.get(n)!;
  return { x: (s.lon - lon0) * M_PER_DEG_LON * PX_PER_M, y: -(s.lat - lat0) * M_PER_DEG_LAT * PX_PER_M };
});

// ---- edges: unique adjacent pairs, with the length each leg WANTS ----
interface Edge {
  a: number;
  b: number;
  want: number;
}
const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const edges: Edge[] = [];
const seen = new Set<string>();
for (const n of names) {
  for (const d of departuresFrom(n)) {
    const k = edgeKey(n, d.next);
    if (seen.has(k) || !idx.has(d.next)) continue;
    seen.add(k);
    const i = idx.get(n)!;
    const j = idx.get(d.next)!;
    const distM = legBetween(n, d.next)?.distM ?? 800;
    const halvesM = (halfLen[i] + halfLen[j]) / PX_PER_M;
    const tunnel = Math.max(MIN_TUNNEL, M(LEG_SCALE * Math.max(0, distM - halvesM)));
    edges.push({ a: i, b: j, want: halfLen[i] + halfLen[j] + tunnel });
  }
}

// ---- initial guess: the projection, scaled to the wanted edge lengths ----
const ratios = edges
  .map((e) => {
    const dx = proj[e.a].x - proj[e.b].x;
    const dy = proj[e.a].y - proj[e.b].y;
    return e.want / Math.max(1, Math.hypot(dx, dy));
  })
  .sort((p, q) => p - q);
const scale0 = ratios[Math.floor(ratios.length / 2)];
const pos = proj.map((p) => ({ x: p.x * scale0, y: p.y * scale0 }));
const prior = proj.map((p) => ({ x: p.x * scale0, y: p.y * scale0 }));

// ---- stress majorization, with the geographic prior and a separation pass ----
const PRIOR_W = 0.02; // strong enough to hold the city's shape, weak enough to yield
const adj = new Set(edges.map((e) => `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}`));

for (let iter = 0; iter < 600; iter++) {
  const nx = pos.map(() => 0);
  const ny = pos.map(() => 0);
  const wsum = pos.map(() => 0);
  for (const e of edges) {
    const dx = pos[e.a].x - pos[e.b].x;
    const dy = pos[e.a].y - pos[e.b].y;
    const d = Math.max(1, Math.hypot(dx, dy));
    const w = 1 / (e.want * e.want);
    const tx = (dx / d) * e.want;
    const ty = (dy / d) * e.want;
    nx[e.a] += w * (pos[e.b].x + tx);
    ny[e.a] += w * (pos[e.b].y + ty);
    wsum[e.a] += w;
    nx[e.b] += w * (pos[e.a].x - tx);
    ny[e.b] += w * (pos[e.a].y - ty);
    wsum[e.b] += w;
  }
  for (let i = 0; i < pos.length; i++) {
    const wp = (PRIOR_W * 1) / (M(500) * M(500));
    nx[i] += wp * prior[i].x;
    ny[i] += wp * prior[i].y;
    wsum[i] += wp;
    pos[i] = { x: nx[i] / wsum[i], y: ny[i] / wsum[i] };
  }
  // separation: two stations that share no leg must not share ground, keep
  // their centres a platform-length-ish apart so the arenas cannot touch
  if (iter % 5 === 4) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        if (adj.has(`${i}|${j}`)) continue;
        const need = (halfLen[i] + halfLen[j]) * 0.75 + M(50);
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= need || d < 1) continue;
        const push = (need - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        pos[i] = { x: pos[i].x - ux * push, y: pos[i].y - uy * push };
        pos[j] = { x: pos[j].x + ux * push, y: pos[j].y + uy * push };
      }
    }
  }
}

// ---- axes from the SOLVED geometry ----
// The PRINCIPAL direction of the neighbour bearings, a LINE, not a signed
// direction, because the per-service dir labels disagree about which way is
// "+1" at an interchange (at T-Centralen the green +1 leaves south and the
// red +1 north, by construction of their station lists). Which END a given
// leg joins is resolved geometrically downstream (worldNet.endSign): the end
// whose axis dot with the neighbour is positive.
const axis = names.map((n, i) => {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const d of departuresFrom(n)) {
    const j = idx.get(d.next);
    if (j === undefined) continue;
    const dx = pos[j].x - pos[i].x;
    const dy = pos[j].y - pos[i].y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    xx += ux * ux;
    xy += ux * uy;
    yy += uy * uy;
  }
  // leading eigenvector of the 2x2 scatter matrix
  const tr = xx + yy;
  const det = xx * yy - xy * xy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax: number;
  let ay: number;
  if (Math.abs(xy) > 1e-9) {
    ax = l1 - yy;
    ay = xy;
  } else if (xx >= yy) {
    ax = 1;
    ay = 0;
  } else {
    ax = 0;
    ay = 1;
  }
  let a = Math.atan2(ay, ax);
  // a deterministic sign convention so the data is stable across runs
  if (a <= -Math.PI / 2 || a > Math.PI / 2) a += a > 0 ? -Math.PI : Math.PI;
  return a;
});

// ---- report ----
let worstEdge = 0;
let worstPair = '';
let worstGap = Infinity;
let worstGapPair = '';
for (const e of edges) {
  const d = Math.hypot(pos[e.a].x - pos[e.b].x, pos[e.a].y - pos[e.b].y);
  const err = Math.abs(d - e.want) / e.want;
  if (err > worstEdge) {
    worstEdge = err;
    worstPair = `${names[e.a]} to ${names[e.b]}`;
  }
  const gap = d - halfLen[e.a] - halfLen[e.b];
  if (gap < worstGap) {
    worstGap = gap;
    worstGapPair = `${names[e.a]} to ${names[e.b]}`;
  }
}
let closest = Infinity;
let closestPair = '';
for (let i = 0; i < pos.length; i++) {
  for (let j = i + 1; j < pos.length; j++) {
    if (adj.has(`${i}|${j}`)) continue;
    const d = Math.hypot(pos[j].x - pos[i].x, pos[j].y - pos[i].y) - halfLen[i] - halfLen[j];
    if (d < closest) {
      closest = d;
      closestPair = `${names[i]} / ${names[j]}`;
    }
  }
}
console.log(`stations: ${names.length}, legs: ${edges.length}`);
console.log(`worst edge-length error: ${(worstEdge * 100).toFixed(1)}%: ${worstPair}`);
console.log(`tightest leg gap between platform ends: ${(worstGap / PX_PER_M).toFixed(0)} m: ${worstGapPair}`);
console.log(
  `closest non-adjacent platforms (centre gap minus halves): ${(closest / PX_PER_M).toFixed(0)} m: ${closestPair}`,
);

const out = {
  meta: {
    pxPerM: PX_PER_M,
    legScale: LEG_SCALE,
    note: 'solved by scripts/gen/worldLayout.ts: do not edit by hand',
  },
  stations: names.map((n, i) => ({
    name: n,
    x: Math.round(pos[i].x * 100) / 100,
    y: Math.round(pos[i].y * 100) / 100,
    axis: Math.round(axis[i] * 1e6) / 1e6,
  })),
};
writeFileSync('data/worldLayout.json', JSON.stringify(out, null, 1) + '\n');
console.log('wrote data/worldLayout.json');
