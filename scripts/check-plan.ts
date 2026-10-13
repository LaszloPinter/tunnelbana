// THE STATION DATA, held to what the geometry assumes of it.
//
//   node --experimental-strip-types scripts/check-plan.ts
//
// The crossing tracks of 2026-09-03 came from conventions nobody had written
// down. This writes them down as assertions, so a change to the platform
// plan or the layout fails here rather than as a train drawn in the rock.

import * as C from '../src/config.ts';
import { ALL_STATIONS, SERVICES, departuresFrom } from '../src/core/network.ts';
import { bandOfService, stationBands } from '../src/core/stationLayout.ts';
import { frameOf } from '../src/core/worldNet.ts';
import { corridorOf } from '../src/core/corridor.ts';
import { corridorLevelAt } from '../src/core/tube.ts';
import { linePathOf } from '../src/core/linePath.ts';
import { stationPlan } from '../src/data/platformPlan.ts';

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};
const ok = (s: string) => console.log('  ok   ' + s);

// 1. every station has a frame on the plane, and every storey has a track
for (const name of ALL_STATIONS) {
  const plan = stationPlan(name);
  for (let li = 0; li < plan.levels.length; li++) {
    if (!frameOf(name, li)) fail(`${name} storey ${li} has no frame`);
    if (stationBands(name, li).tracks.length === 0) fail(`${name} storey ${li} has no tracks`);
  }
}
ok('every station has a frame and every storey a track');

// 2. every service has a band at every station it calls at, in the
// direction it runs there (a terminus falls back to the service alone)
let bands = 0;
for (const svc of SERVICES) {
  svc.stations.forEach((name, i) => {
    for (const dir of [1, -1] as const) {
      if (svc.stations[i + dir] === undefined) continue;
      bands += 1;
      if (!bandOfService(name, svc.id, dir)) fail(`${svc.id} has no band at ${name} running ${dir}`);
    }
  });
}
ok(`${bands} service directions each have a band at their station`);

// 3. a through storey runs a service's direction on ONE track, the bore
// slots and the line paths both assume it
for (const name of ALL_STATIONS) {
  const plan = stationPlan(name);
  for (let li = 0; li < plan.levels.length; li++) {
    const seen = new Map<string, number>();
    for (const t of stationBands(name, li).tracks) {
      if (t.options.length === 0) continue;
      for (const id of t.services) {
        const key = `${id}:${t.dir}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of seen) {
      // a stub terminus lists its departures on both platforms: allowed
      const terminus = departuresFrom(name).every((d) => d.dir === Number(key.split(':')[1]));
      if (n > 1 && !terminus) fail(`${name} storey ${li} runs ${key} on ${n} tracks`);
    }
  }
}
ok("each storey runs a service's direction on one track (stub termini excepted)");

// 4. every leg is one corridor with two distinct mouths, and every line path builds
for (const svc of SERVICES) {
  for (const dir of [1, -1] as const) if (!linePathOf(svc.id, dir)) fail(`${svc.id} ${dir} has no line path`);
  for (let i = 0; i + 1 < svc.stations.length; i++) {
    const c = corridorOf(svc.stations[i], svc.stations[i + 1]);
    if (!c) fail(`no corridor ${svc.stations[i]} to ${svc.stations[i + 1]}`);
    else if (c.s1 - c.s0 < C.M(60))
      fail(`corridor ${c.a}|${c.b} is only ${((c.s1 - c.s0) / C.PX_PER_M) | 0} m`);
  }
}
ok('every leg is a corridor and every line threads as one path');

// 5. a direction's track keeps its side of the bore from platform to platform.
// A single-track line end (a track on the bore's centreline at one mouth)
// has no side to keep; everything else must.
let traversals = 0;
let ends = 0;
for (const svc of SERVICES) {
  for (const dir of [1, -1] as const) {
    for (const p of linePathOf(svc.id, dir)!.pieces) {
      if (p.kind !== 'corridor') continue;
      traversals += 1;
      const singleTrackEnd =
        Math.abs(p.tIn) < C.M(1) || Math.abs(p.tOut) < C.M(1) || Math.abs(p.tBore) < C.M(1);
      // ...nor a THROAT: at a stub terminus each line owns a platform and
      // the through tracks fan out to them over the points (Kungsträdgården);
      // at a junction storey the branch's track lies between the others
      // (Västra skogen). The crossing is real and happens in the station.
      const throat = (st: string) =>
        svc.stations[0] === st ||
        svc.stations[svc.stations.length - 1] === st ||
        (stationBands(st, corridorLevelAt(p.cor, st)).tracks.length > 2 && !p.wide);
      if (singleTrackEnd || throat(p.cor.a) || throat(p.cor.b)) {
        ends += 1;
        continue;
      }
      if (Math.sign(p.tIn) !== Math.sign(p.tOut))
        fail(`${svc.id} ${dir} ${p.cor.a}|${p.cor.b}: the track swaps sides between the two platforms`);
    }
  }
}
ok(`${traversals} leg traversals keep their side of the bore (${ends} single-track ends excepted)`);

console.log(failed ? `${failed} FAILED` : 'PASS');
process.exit(failed ? 1 : 0);
