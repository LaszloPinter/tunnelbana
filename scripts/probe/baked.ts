// THE BAKED MAP IS THE WHOLE WALKABLE WORLD, AND IT JOINS UP.
//
// The floor is one set of flat world-space patches (src/world/bake.ts), cut
// into a grid only so a point can be answered quickly (src/world/chunks.ts).
// No room owns a coordinate system and nothing is projected onto a curve, so
// the two things worth checking are the two that used to go wrong:
//
//   - walk a bore end to end and something is always underfoot. A gap is
//     somewhere a body falls out of the world, and that is what a seam was.
//   - the ground the bore describes and the ground the platform describes
//     agree where they meet, so stepping off the end of a platform is
//     stepping onto tunnel floor rather than into a hole.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { bakeFloor } from '../../src/world/bake.ts';
import { Chunks } from '../../src/world/chunks.ts';
import { fromLeg } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const STEP = C.M(1);
const faults: string[] = [];
let bores = 0;
let points = 0;
let holes = 0;

for (const name of ALL_STATIONS) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0) continue;
  for (const e of [1, -1] as const) {
    for (const c of corridorsToward(st, e)) {
      const a = asStation(sim.ensurePlace(c.a));
      const b = asStation(sim.ensurePlace(c.b));
      if (!a || !b) continue;
      // each end shows the storey its bore joins, as arriving does
      showLevel(sim, a, c.la);
      showLevel(sim, b, c.lb);
      const leg = sim.ensureLeg(c);
      const map = new Chunks(bakeFloor([a, b, leg]));
      bores += 1;

      // ---- along the bore, and a little way into each platform ----
      for (let s = c.s0 - C.M(10); s <= c.s1 + C.M(10); s += STEP) {
        const p = fromLeg(leg, Math.max(c.s0, Math.min(c.s1, s)), 0);
        points += 1;
        if (map.solid(p.x, p.y)) continue;
        holes += 1;
        faults.push(
          `${leg.id}: nothing underfoot ${((s - c.s0) / C.PX_PER_M).toFixed(0)} m past the ${c.a} mouth`,
        );
      }

      // ---- across the bore, at the walls, where the ribbon has to be
      // exactly as wide as the tunnel it stands for ----
      for (let f = 0.02; f < 1; f += 0.03) {
        const s = c.s0 + (c.s1 - c.s0) * f;
        const band = leg.arcBand(s);
        for (const t of [band.top + C.M(0.4), 0, band.bottom - C.M(0.4)]) {
          const p = fromLeg(leg, s, t);
          points += 1;
          if (map.solid(p.x, p.y)) continue;
          holes += 1;
          faults.push(`${leg.id}: the bore's own floor is not baked at t=${(t / C.PX_PER_M).toFixed(1)} m`);
        }
        // ...and just outside the wall there is rock
        const out = fromLeg(leg, s, band.bottom + C.M(6));
        points += 1;
        if (map.at(out.x, out.y)?.kind === 'bore')
          faults.push(`${leg.id}: six metres past the wall is still floor`);
      }
    }
  }
}

const ok = faults.length === 0;
console.log(
  `baked: ${bores} bores, ${points} points on the baked map, ${holes} with nothing underfoot / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
