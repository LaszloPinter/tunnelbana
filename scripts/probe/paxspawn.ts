// PASSENGERS ON THE PLATFORM (DESIGN §20): when a station comes alive there
// are groups waiting for trains, each beside its own track, now and then a
// guard at his post. The same seed meets the same strangers; the tutorial
// meets nobody; and over a handful of seeds there are groups and guards.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { onPlatform } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];

function start(seed: number, tutorial = false) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.tutorial = tutorial;
  sim.startRun();
  sim.beginRun();
  const edges = new InputEdges();
  for (let k = 0; k < 30; k++) {
    sim.me.iframesUntil = sim.gameNow + 5000;
    sim.runTick(edges.sample(0, 0, 0, sim.me.x + 50, sim.me.y, answerPicks(sim)));
  }
  return sim;
}

const list = (sim: Run) =>
  sim.pax
    .map((q) => `${q.id}:${q.kind}:${q.plan}:${q.group}:${q.placeId}:${q.waitTi}:${q.lookSeed}`)
    .join('|');

let people = 0;
let guards = 0;
let groups = 0;
let bigGroups = 0;
for (let seed = 1; seed <= 12; seed++) {
  const a = start(seed);
  const b = start(seed);
  if (list(a) !== list(b)) faults.push(`seed ${seed}: two starts met different strangers`);
  people += a.pax.length;
  guards += a.pax.filter((q) => q.kind === 'vaktare').length;
  const byGroup = new Map<number, number>();
  for (const q of a.pax) byGroup.set(q.group, (byGroup.get(q.group) ?? 0) + 1);
  groups += byGroup.size;
  for (const n of byGroup.values()) {
    if (n > 4) faults.push(`seed ${seed}: a group of ${n}`);
    if (n >= 3) bigGroups += 1;
  }
  for (const q of a.pax) {
    // those still riding in have no spot yet: it is given when they step off
    if (q.plan !== 'catch' || q.mode !== 'foot') continue;
    const st = asStation(a.places.get(q.placeId));
    const pf = st?.platforms.find((p) => p.railTop === q.waitTi || p.railBottom === q.waitTi);
    // the GROUP'S spot: where one of them stands right now may be a machine (combat/paxIdle.ts)
    const l = st ? onPlatform(st, q.anchorX, q.anchorY) : null;
    if (!st || !pf || !l) {
      faults.push(
        `seed ${seed}: somebody waits for track ${q.waitTi} at ${q.placeId}, which has no island beside it`,
      );
      continue;
    }
    const edge = pf.railTop === q.waitTi ? pf.top : pf.bottom;
    if (Math.abs(l.y - edge) > C.M(3))
      faults.push(
        `seed ${seed}: a wait spot ${(Math.abs(l.y - edge) / C.PX_PER_M).toFixed(1)} m from its track`,
      );
  }
}
if (people === 0) faults.push('twelve seeds and not one passenger on any live platform');
if (guards === 0) faults.push('twelve seeds and not one guard');
if (bigGroups === 0) faults.push('twelve seeds and not one group of three or four');
const tut = start(1, true);
if (tut.pax.length > 0) faults.push(`the tutorial has ${tut.pax.length} passengers`);

console.log(
  `paxspawn: ${people} people in ${groups} groups (${guards} guards) over 12 seeds, waiting by their tracks / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults.slice(0, 12)) console.log('  ' + f);
if (faults.length) process.exitCode = 1;
