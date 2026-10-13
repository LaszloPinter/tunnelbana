// YOU CAN WALK THE MAP.
//
// The whole point of the 2-D world: set off from a platform, walk in a
// straight line on the map, and arrive at the next station having gone
// through the tunnel, with no crossing, no handover and nothing mapped
// between frames on the way. The tunnel curves, so walking it means turning
// with it; a walker who only ever pushed +x would meet the wall.
//
// This is the test that the ground actually joins up under a moving body,
// which is a stronger thing than the floor having no holes in it (`map2d`):
// a body has to be able to GET from one room to the next.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { fromLeg } from '../../src/world/floor.ts';
import { slide, standAt } from '../../src/world/walk.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();

const SPEED = C.M(0.13);
const faults: string[] = [];
let tried = 0;
let arrived = 0;
let worstSteps = 0;

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
    const rooms = [a, b, leg];
    const far = c.a === name ? b : a;
    // start on the bore's centreline just inside the mouth we are leaving by
    const startS = c.a === name ? c.s0 + C.M(2) : c.s1 - C.M(2);
    const goS = c.a === name ? 1 : -1;
    let p = fromLeg(leg, startS, 0);
    if (standAt(rooms, p.x, p.y).kind === 'none') {
      faults.push(`${leg.id}: cannot even stand at the ${name} mouth`);
      continue;
    }
    tried += 1;
    // walk the tunnel by following it: aim a little further along the curve
    // each step, which is what walking a bend is
    let k = 0;
    let s = startS;
    let done = false;
    for (; k < 20000; k++) {
      s += goS * SPEED;
      const target = fromLeg(leg, Math.max(0, Math.min(c.length, s)), 0);
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const moved = slide(rooms, p.x, p.y, (dx / d) * SPEED, (dy / d) * SPEED);
      p = { x: moved.x, y: moved.y };
      const on = standAt(rooms, p.x, p.y);
      if (on.place === far && on.kind !== 'bore') {
        done = true;
        break;
      }
      if (goS > 0 ? s > c.s1 + C.M(30) : s < c.s0 - C.M(30)) break;
    }
    if (done) {
      arrived += 1;
      worstSteps = Math.max(worstSteps, k);
    } else {
      const on = standAt(rooms, p.x, p.y);
      faults.push(`${name} -> ${far.name} along ${leg.id}: stopped on ${on.kind} after ${k} steps`);
    }
  }
}

const ok = faults.length === 0;
console.log(
  `walk2d: ${arrived}/${tried} walks from a platform through a curved bore to the next station, worst ${worstSteps} steps / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
