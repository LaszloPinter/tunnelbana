// THE MAP IS ONE CONTINUOUS FLOOR.
//
// Stockholm's metro is a map, not a line: stations stand at real places with
// real bearings, and the tunnels between them are curves. src/world/floor.ts
// asks one question of a point on that map, what are you standing on, and
// this is the test that the answer never has a hole in it.
//
// Walk the CENTRELINE of a bore from one platform to the other, in world
// coordinates, and at every step something must be underfoot: the platform
// you left, the rock you are in, or the platform you are arriving at. A gap
// is a place where a body falls out of the world; and because the bore and
// the platform are two different descriptions of the same ground, a gap is
// exactly what a seam used to be.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { corridorPos } from '../../src/core/corridor.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { standInLeg, standOnStation, fromLeg } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const STEP = C.M(1);
const faults: string[] = [];
let bores = 0;
let steps = 0;
let holes = 0;

for (const name of ALL_STATIONS) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0) continue;
  for (const e of [1, -1] as const) {
    for (const c of corridorsToward(st, e)) {
      // SHOW EACH END THE STOREY THIS BORE JOINS, as arriving does
      // (sim/legWalk.ts enterLeg). A stacked station is several rooms one
      // above another and only one of them is laid out at a time; asking the
      // wrong one where its floor is gets an honest answer about a platform
      // this tunnel does not meet.
      const a = asStation(sim.ensurePlace(c.a));
      const b = asStation(sim.ensurePlace(c.b));
      if (!a || !b) continue;
      showLevel(sim, a, c.la);
      showLevel(sim, b, c.lb);
      const leg = sim.ensureLeg(c);
      bores += 1;
      // from a little inside one platform, along the bore, to a little
      // inside the other, every step a point on the map
      let gap = 0;
      for (let s = c.s0 - C.M(8); s <= c.s1 + C.M(8); s += STEP) {
        const p =
          s < c.s0 || s > c.s1 ? corridorPos(c, Math.max(0, Math.min(c.length, s))) : fromLeg(leg, s, 0);
        steps += 1;
        const here =
          standInLeg(leg, p.x, p.y).kind !== 'none' ||
          standOnStation(a, p.x, p.y).kind !== 'none' ||
          standOnStation(b, p.x, p.y).kind !== 'none';
        if (here) {
          gap = 0;
          continue;
        }
        gap += STEP;
        holes += 1;
        if (gap === STEP)
          faults.push(
            `${leg.id}: nothing underfoot ${((s - c.s0) / C.PX_PER_M).toFixed(0)} m past the ${c.a} mouth`,
          );
      }
    }
  }
}

const ok = faults.length === 0;
console.log(
  `map2d: ${bores} bores walked on the map, ${steps} points, ${holes} with nothing underfoot / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} gaps in all`);
process.exit(ok ? 0 : 1);
