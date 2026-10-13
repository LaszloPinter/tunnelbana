// THE STAIRS BETWEEN STOREYS PUT YOU SOMEWHERE REAL.
//
// A stacked station is not one place with a setting: each storey is its own
// room, at its own bearing, joining its own tunnels. Where a shaft comes out
// is said in THAT room's plan, so far along the platform, so far across,
// and on the map that has to be turned into a point in Stockholm before
// anyone is put there. Written straight in, the whole party arrives at a
// coordinate belonging to nothing and the world goes black around them (from
// play 2026-09-12: "I took NER to nowhere").
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { asStation } from '../../src/sim/place.ts';
import { takeShaft } from '../../src/sim/ground.ts';
import { stationPlan } from '../../src/data/platformPlan.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';

const faults: string[] = [];
let tried = 0;
let landed = 0;

// the stacked ones are the only ones with anywhere to go
const stacked = ALL_STATIONS.filter((n) => stationPlan(n).levels.length > 1).slice(0, 8);

for (const name of stacked) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  // stand in the stacked station itself, whichever storey it is showing
  sim.hereId = sim.ensurePlace(name).id;
  for (const p of sim.players) p.placeId = sim.hereId;
  const st = asStation(sim.here);
  if (!st) continue;
  const edges = new InputEdges();
  sim.runTick(edges.sample(0, 0, 0, sim.me.x, sim.me.y, answerPicks(sim)));
  for (const shaft of st.shafts) {
    const from = st.levelIndex;
    tried += 1;
    // a horde on this floor, so the stairs can be seen not to kill it
    st.enemies.length = 0;
    for (let k = 0; k < 3; k++)
      spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, sim.me.x, sim.me.y, false);
    const had = st.enemies.length;
    takeShaft(sim, sim.me, shaft, sim.gameNow);
    if (st.enemies.length !== 0)
      faults.push(`${name}: the other storey started with ${st.enemies.length} of this one's mobs`);
    const on = sim.map.at(sim.me.x, sim.me.y);
    if (!on) {
      faults.push(`${name}: took the stairs from level ${from} and arrived on NOTHING`);
    } else if (on.kind !== 'platform') {
      faults.push(`${name}: came off the stairs onto a ${on.kind}, not a deck`);
    } else landed += 1;
    // ...and back, so the next shaft is tried from a real place, with the
    // horde exactly as it was left (a storey is its own room)
    const back = st.shafts.find((sh) => sh.delta === -shaft.delta);
    if (back) takeShaft(sim, sim.me, back, sim.gameNow);
    if (back && st.enemies.length !== had)
      faults.push(`${name}: went down and up and ${had} mobs became ${st.enemies.length}`);
  }
}

const ok = faults.length === 0;
console.log(
  `shafts2d: ${landed}/${tried} stair rides came out on a deck at ${stacked.length} stacked stations / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of [...new Set(faults)]) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
