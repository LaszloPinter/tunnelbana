// A STACKED STATION IS SEVERAL ROOMS AT ONE POINT ON THE MAP, and the map
// has no up. Standing in one of them, nothing from the others may be live
// around you: not the bores a flight up, their floor, rock and dark would be
// laid across the hall, and not the trains in them, which ran diagonally
// through the platform at Fridhemsplan (from play 2026-09-13). The live set
// walks ROOMS, by the lines that leave the storey you are on (sim/places.ts).
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { asLeg, asStation } from '../../src/sim/place.ts';
import { takeShaft } from '../../src/sim/ground.ts';
import { stationPlan } from '../../src/data/platformPlan.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import { departuresFrom } from '../../src/core/network.ts';
import { bandOfService } from '../../src/core/stationLayout.ts';
import { corridorLevelAt } from '../../src/core/tube.ts';
import { journeyById } from '../../src/core/fleet.ts';
import { trainCars } from '../../src/world/trains2d.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let storeys = 0;

const stacked = ALL_STATIONS.filter((n) => stationPlan(n).levels.length > 1);

function check(sim: Run, tag: string) {
  const st = asStation(sim.here);
  if (!st) return;
  storeys += 1;
  // the lines that leave THIS storey
  const here = departuresFrom(st.name).filter(
    (d) => (bandOfService(st.name, d.service.id, d.dir)?.levelIndex ?? 0) === st.levelIndex,
  );
  // every live tube into this station joins it AT THE STOREY SHOWN, a tube
  // to another hall lands on a mouth that is not there (core/corridor.ts)
  for (const id of sim.live) {
    const leg = asLeg(sim.places.get(id));
    if (!leg || (leg.cor.a !== st.name && leg.cor.b !== st.name)) continue;
    const joins = corridorLevelAt(leg.cor, st.name);
    if (joins !== st.levelIndex)
      faults.push(`${tag}: ${leg.id} is live, and it joins ${st.name} at storey ${joins}`);
  }
  // ...and no train the picture would draw near it calls at another storey
  const mid = fromPlatform(st, (st.platformX0 + st.platformX1) / 2, 0);
  for (const jid of sim.metalNear(0, 0)) {
    const j = journeyById(jid);
    const seat = j && trainCars(jid, sim.gameNow);
    const at = seat?.(C.M(70));
    if (!j || !at) continue;
    if (Math.hypot(at.x - mid.x, at.y - mid.y) > C.M(250)) continue;
    if (!sim.sameStorey(jid, at.x, at.y)) continue;
    if (!here.some((d) => d.service.id === j.service.id))
      faults.push(
        `${tag}: train ${jid} drawn in the hall, and its line never calls at storey ${st.levelIndex}`,
      );
  }
}

for (const name of stacked) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  sim.hereId = sim.ensurePlace(name).id;
  for (const p of sim.players) p.placeId = sim.hereId;
  const st = asStation(sim.here);
  if (!st) continue;
  const at = fromPlatform(
    st,
    (st.platformX0 + st.platformX1) / 2,
    (st.platforms[0].top + st.platforms[0].bottom) / 2,
  );
  for (const p of sim.players) spawnAt(sim, p, at.x, at.y);
  const edges = new InputEdges();
  const tick = () => sim.runTick(edges.sample(0, 0, 0, sim.me.x, sim.me.y, answerPicks(sim)));
  for (let i = 0; i < 3; i++) tick();
  check(sim, `${name} storey ${st.levelIndex}`);
  // every other storey, by its stairs
  for (let n = 0; n < stationPlan(name).levels.length - 1; n++) {
    const down = st.shafts.find((sh) => sh.delta === -1) ?? st.shafts[0];
    if (!down) break;
    takeShaft(sim, sim.me, down, sim.gameNow);
    for (let i = 0; i < 3; i++) tick();
    check(sim, `${name} storey ${st.levelIndex}`);
  }
}

const ok = faults.length === 0;
console.log(
  `storeys2d: ${storeys} storeys at ${stacked.length} stacked stations, nothing from another storey live / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of [...new Set(faults)]) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
