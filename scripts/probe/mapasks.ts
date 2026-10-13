// THE MAP'S ANSWERS ARE THE ROOMS' OWN ANSWERS.
//
// src/world/map.ts takes a point on the map and answers for whichever room it
// falls in, converting into that room's own along-and-across at the moment of
// asking. That is only worth anything if the answer is the SAME answer the
// room gives about itself: a façade that quietly disagrees with what it
// delegates to is one more frame to get out of step with, which is the
// disease and not the cure.
//
// So: take points from each room's own description, put them on the map, ask
// the map, and check it agrees, islands, beds, columns, benches, and whether
// this is tunnel or platform.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { fromPlatform, fromLeg } from '../../src/world/floor.ts';
import { WorldMap } from '../../src/world/map.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const R = C.M(0.5);
const faults: string[] = [];
let asked = 0;

for (const name of ALL_STATIONS) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0) continue;
  for (const e of [1, -1] as const) {
    const c = corridorsToward(st, e)[0];
    if (!c) continue;
    const a = asStation(sim.ensurePlace(c.a));
    const b = asStation(sim.ensurePlace(c.b));
    if (!a || !b) continue;
    showLevel(sim, a, c.la);
    showLevel(sim, b, c.lb);
    const leg = sim.ensureLeg(c);
    const map = new WorldMap([a, b, leg]);

    // ---- the platform's own points ----
    for (const room of [a, b]) {
      for (let f = 0.08; f < 1; f += 0.11) {
        const lx = room.platformX0 + (room.platformX1 - room.platformX0) * f;
        for (const pf of room.platforms) {
          const ly = (pf.top + pf.bottom) / 2;
          const w = fromPlatform(room, lx, ly);
          asked += 1;
          const mine = room.platformAt(ly);
          const theirs = map.platformAt(w.x, w.y);
          if (mine !== theirs)
            faults.push(`${room.name}: island ${mine} by the platform, ${theirs} by the map`);
          const pillarMine = room.pillarAt(lx, ly, R);
          if (pillarMine !== map.pillarAt(w.x, w.y, R))
            faults.push(`${room.name}: the map and the platform disagree about a column`);
          if (map.inTunnel(w.x, w.y))
            faults.push(`${room.name}: the map calls a point on its own deck a tunnel`);
        }
        for (const rl of room.rails) {
          const ly = (rl.bandTop + rl.bandBottom) / 2;
          const w = fromPlatform(room, lx, ly);
          asked += 1;
          if (room.railBedAt(ly) !== map.railBedAt(w.x, w.y))
            faults.push(`${room.name}: the map and the platform disagree about a track bed`);
        }
      }
    }

    // ---- and the bore's own points ----
    //
    // WELL CLEAR OF EITHER MOUTH. A bore opens out to the width of the
    // platform it meets, so near a mouth the tunnel's floor and the
    // platform's ARE the same ground and either answer is right, that
    // overlap is the thing that makes stepping off a platform continuous.
    // Out in the middle there is only rock.
    const MOUTH = C.M(60);
    for (let f = 0.05; f < 1; f += 0.09) {
      const s = c.s0 + (c.s1 - c.s0) * f;
      const deep = s > c.s0 + MOUTH && s < c.s1 - MOUTH;
      const band = leg.arcBand(s);
      for (const t of [band.top + R, 0, band.bottom - R]) {
        const w = fromLeg(leg, s, t);
        asked += 1;
        if (deep && !map.inTunnel(w.x, w.y))
          faults.push(`${leg.id}: the map does not call its own floor a tunnel at t=${t.toFixed(0)}`);
        if (map.standAt(w.x, w.y).kind === 'none')
          faults.push(`${leg.id}: nothing underfoot on the bore's own floor`);
      }
    }
  }
}

const ok = faults.length === 0;
console.log(`mapasks: ${asked} points asked of both the map and the room itself / ${ok ? 'PASS' : 'FAIL'}`);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
