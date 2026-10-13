// The real case: running down the corridor, leaning at the wall, how long
// until you are actually inside a recess? (corridor coordinates: x is arc
// length along the leg, y is lateral; the view axes belong to the station
// you entered from)
//
//   node --experimental-strip-types scripts/probe/recess-enter.ts

import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { putInLegAt } from '../lib/legs.ts';
import { InputEdges, CHOICE } from '../../src/sim/tick.ts';
import {
  BORE_WALL,
  corridorOf,
  corridorPos,
  corridorProject,
  recessCentres,
} from '../../src/core/corridor.ts';
import * as C from '../../src/config.ts';

const times: number[] = [];
for (const startM of [12, 37, 58, 71, 96, 118, 141, 163]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  // a COVERED leg, deliberately: bridges have a walkway the whole way and
  // prove nothing about recesses
  const c = corridorOf('Gamla stan', 'T-Centralen')!;
  const startName = 'Gamla stan';
  const atA = c.a === startName;
  me.frame = { kind: 'world' };
  // THE RECESS MECHANIC ALONE. The tunnel's ambush (sim/tunnelEvents.ts)
  // springs at 140 m in and would make this a fight, which is a different
  // measurement; mark the leg already sprung.
  sim.ensureLeg(c).cleared = true;
  putInLegAt(sim, me, c, atA ? c.s0 + C.M(startM) : c.s1 - C.M(startM), -(BORE_WALL - me.r - 1)); // already hugging the upper wall
  // a leg is a place with its own frame now (sim/legPlace.ts): deeper is
  // simply toward the far mouth, and the wall is at negative t
  const deeper = atA ? 1 : -1;
  const edges = new InputEdges();
  let got = -1;
  for (let t = 0; t < 60 * 20; t++) {
    sim.here.enemies.length = 0;
    me.health = 999;
    me.iframesUntil = sim.gameNow + 5000;
    me.noTrainHitUntil = sim.gameNow + 5000;
    // on the map the stick is a world direction: along the bore's tangent
    // where the walker is, leaning toward the wall at negative lateral
    const here = corridorProject(c, me.x, me.y);
    const q = corridorPos(c, here.s);
    const mx = deeper * q.tx + q.ty;
    const my = deeper * q.ty - q.tx;
    const n = Math.hypot(mx, my) || 1;
    sim.runTick(edges.sample(0, mx / n, my / n, 0, 0, CHOICE.none));
    if (sim.inRecess(me)) {
      got = t;
      break;
    }
  }
  const sStart = atA ? c.s0 + C.M(startM) : c.s1 - C.M(startM);
  let gap = Infinity;
  for (const rc of recessCentres(c)) gap = Math.min(gap, Math.abs(rc - sStart));
  console.log(
    `start ${String(startM).padStart(3)} m past the platform (nearest recess ${(gap / C.PX_PER_M).toFixed(0)} m away): ` +
      (got < 0 ? 'never got in' : `in after ${(got / 60).toFixed(1)} s`),
  );
  if (got >= 0) times.push(got / 60);
}
console.log(
  times.length === 8
    ? `all 8 made it, worst ${Math.max(...times).toFixed(1)} s`
    : `${times.length}/8 made it`,
);
process.exit(times.length === 8 ? 0 : 1);
