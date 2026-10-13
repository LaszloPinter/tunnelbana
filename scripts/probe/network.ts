// Is the whole network actually on the map, and is the map right?
//
//   node --experimental-strip-types scripts/probe/network.ts
//
// The map (src/core/networkMap.ts) is the foundation the tunnel rework stands
// on, so it gets checked against the data it came from rather than eyeballed:
// every station placed, every leg the right length, every tunnel leaving and
// arriving along the platform it is attached to, and no two stations sitting
// on top of each other.

import * as C from '../../src/config.ts';
import { allMapStations, mapStation, legPath, legStraightPx, mapBounds } from '../../src/core/networkMap.ts';
import { ALL_STATIONS, departuresFrom } from '../../src/core/network.ts';
import { dist } from '../../src/sim/det.ts';

const m = (px: number) => (px / C.PX_PER_M / C.LEG_SCALE).toFixed(0);
const km = (px: number) => (px / C.PX_PER_M / C.LEG_SCALE / 1000).toFixed(1);

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};

// ---- 1. is everything on it? ----
const placed = allMapStations();
console.log(`stations placed: ${placed.length}`);
const missing = ALL_STATIONS.filter((n) => !mapStation(n));
if (missing.length)
  fail(`${missing.length} station(s) the game uses are not on the map: ${missing.slice(0, 5).join(', ')}`);
else console.log('  ok   every station the game can send you to has a position');

// ---- 2. how big is it? ----
const b = mapBounds();
console.log(
  `network extent: ${km(b.maxX - b.minX)} x ${km(b.maxY - b.minY)} km real ` +
    `(${Math.round(b.maxX - b.minX)} x ${Math.round(b.maxY - b.minY)} px in game)`,
);

// ---- 3. are the legs the right length? ----
// The map is projected from lat/lon; legs.json measured the same distance from
// the same source. They should agree to within the slop of a platform.
let legs = 0;
let worstErr = 0;
let worstLeg = '';
let curveOverStraight = 0;
for (const from of ALL_STATIONS) {
  for (const d of departuresFrom(from)) {
    const to = d.next;
    if (!to) continue;
    const p = legPath(from, to);
    const straight = legStraightPx(from, to);
    if (!p || straight === null) continue;
    legs += 1;
    // the curve is longer than the straight line; compare like with like by
    // measuring the chord between the platform ends
    const a = mapStation(from)!;
    const c = mapStation(to)!;
    const chord = dist(c.x - a.x, c.y - a.y);
    const err = Math.abs(chord - straight);
    if (err > worstErr) {
      worstErr = err;
      worstLeg = `${from} -> ${to} (map ${m(chord)} m, data ${m(straight)} m)`;
    }
    // end to end, not centre to centre: the tunnel starts half a platform in
    const ends = dist(p.at(1).x - p.at(0).x, p.at(1).y - p.at(0).y);
    curveOverStraight += p.lengthPx / Math.max(1, ends);
  }
}
console.log(`legs with a tunnel: ${legs}`);
if (legs === 0) fail('no legs at all');
else {
  console.log(`  worst station-to-station error vs data/legs.json: ${m(worstErr)} m: ${worstLeg}`);
  console.log(
    `  a tunnel averages ${(curveOverStraight / legs).toFixed(3)}x the straight line between its own ends`,
  );
  // 60 m is well inside one platform: the projection and the OSM distance are
  // measured between slightly different points on the same station
  if (worstErr > C.M(60) * C.LEG_SCALE) fail(`a leg is ${m(worstErr)} m off what the data says`);
}

// ---- 4. do tunnels join up smoothly? ----
// The curve should leave a station heading the way the platform points, or a
// train would have to turn on the spot at the platform end.
let worstJoin = 0;
let joinLeg = '';
for (const from of ALL_STATIONS) {
  for (const d of departuresFrom(from)) {
    const to = d.next;
    if (!to) continue;
    const p = legPath(from, to);
    const a = mapStation(from);
    if (!p || !a) continue;
    const h = p.headingAt(0);
    // the platform runs along `angle`; leaving along it or against it are both
    // fine, so compare to the nearer of the two
    let e = Math.abs(((h - a.angle + Math.PI) % (2 * Math.PI)) - Math.PI);
    e = Math.min(e, Math.abs(Math.PI - e));
    if (e > worstJoin) {
      worstJoin = e;
      joinLeg = `${from} -> ${to}`;
    }
  }
}
console.log(
  `  worst angle between a platform and its tunnel: ${((worstJoin * 180) / Math.PI).toFixed(1)}°: ${joinLeg}`,
);
if (worstJoin > 0.02) fail('a tunnel does not leave along its platform');

// ---- 5. is anything on top of anything else? ----
let closest = Infinity;
let closestPair = '';
for (let i = 0; i < placed.length; i++) {
  for (let j = i + 1; j < placed.length; j++) {
    const d = dist(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
    if (d < closest) {
      closest = d;
      closestPair = `${placed[i].name} / ${placed[j].name}`;
    }
  }
}
console.log(`  closest two stations: ${m(closest)} m apart: ${closestPair}`);
if (closest < 1) fail('two stations are in the same place');

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);
