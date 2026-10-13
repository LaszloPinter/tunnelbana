// THE THINGS YOU PRESS E AT: a kiosk, a mana machine, a health machine, a
// stair, the way out.
//
// Each is placed in the STATION'S own plan, so far along the platform, so
// far across it, and on the map a body is a point in Stockholm. Comparing
// the two matches at no station, ever: nothing could be bought, no stair
// taken and no run finished (from play 2026-09-11: "kiosks don't work. I
// cannot shop or refill mana"). The exit is the one that matters most, since
// without it a run cannot be completed at all.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { nearFixture } from '../../src/world/fixtures.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let reached = 0;
let tested = 0;

for (const seed of [1, 3, 5, 8, 11, 14]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const st = asStation(sim.here);
  if (!st) continue;
  const kinds: [string, { x: number; y: number }[]][] = [
    ['kiosk', st.kiosks],
    ['mana machine', st.manaMachines],
    ['health machine', st.healthMachines],
    ['way out', st.escalators],
  ];
  for (const [what, list] of kinds) {
    if (list.length === 0) continue;
    for (const m of list) {
      tested += 1;
      // stand exactly where it is, on the map
      const at = fromPlatform(st, m.x, m.y);
      if (!nearFixture(st, list, at.x, at.y, C.M(2))) {
        faults.push(`${st.name}: standing at a ${what} does not reach it`);
        continue;
      }
      reached += 1;
      // ...and a body across the platform does not reach it from there
      const away = fromPlatform(st, m.x + C.M(9), m.y);
      if (nearFixture(st, list, away.x, away.y, C.M(2)))
        faults.push(`${st.name}: a ${what} is reachable from nine metres away`);
    }
  }
}

const ok = faults.length === 0;
console.log(
  `fixtures2d: ${reached}/${tested} fixtures reachable from where they stand / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of [...new Set(faults)]) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
