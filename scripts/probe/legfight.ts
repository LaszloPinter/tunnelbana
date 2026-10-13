// SHOOTING OUT OF A TUNNEL. A bolt fired down a bore reaches the platform at
// its far end and hits the horde standing on it. This used to be a question
// about which side of a leg's halfway mark a bolt was handed over at, and the
// fight around it did not hand over with it, so a shot could reach the next
// station's horde or the vättar in front of you, never both (from play
// 2026-09-06). On the map there is no handover: the mouth is a line on one
// floor, and a bolt crosses it like anything else (2026-09-15).
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { corridorToward } from '../../src/sim/places.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { fromLeg, onPlatform } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let hit = 0;

for (const seed of [1, 2, 3, 4]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const me = sim.me;
  const edges = new InputEdges();
  const origin = asStation(sim.here);
  const c = origin && (corridorToward(origin, 1) ?? corridorToward(origin, -1));
  if (!origin || !c) continue;
  const leg = sim.ensureLeg(c);
  leg.cleared = true;
  // stand forty metres short of the far mouth, on the centreline
  const farIsB = c.a === origin.name;
  const destName = farIsB ? c.b : c.a;
  const dest = asStation(sim.ensurePlace(destName))!;
  const mouth = farIsB ? c.s1 : c.s0;
  const out: 1 | -1 = farIsB ? 1 : -1;
  const stand = fromLeg(leg, mouth - out * C.M(40), 0);
  me.x = stand.x;
  me.y = stand.y;
  me.placeId = leg.id;
  sim.hereId = leg.id;
  // a mark just inside the platform: six metres past the mouth along the
  // bore's own line, which is a track bed of the station beyond
  const spot = fromLeg(leg, mouth + out * C.M(6), 0);
  const local = onPlatform(dest, spot.x, spot.y);
  if (!local) {
    faults.push(`seed ${seed}: the mouth of ${leg.id} does not open onto ${destName}`);
    continue;
  }
  const mark = spawnEnemy(sim.hostFor(dest), 'runner', { kind: 'world' }, local.x, local.y, false);
  mark.hp = 400;
  mark.maxHp = 400;
  mark.speedMul = 0;
  mark.aggro = false;
  const hp0 = mark.hp;
  tried += 1;
  for (let t = 0; t < 60 * 12 && mark.hp === hp0; t++) {
    me.health = 999;
    me.mana = 999;
    me.noTrainHitUntil = sim.gameNow + 9000;
    me.iframesUntil = sim.gameNow + 9000;
    mark.x = spot.x;
    mark.y = spot.y;
    mark.speedMul = 0;
    // aim at the mark, out of the mouth
    sim.runTick(edges.sample(BTN.fire, 0, 0, mark.x, mark.y, answerPicks(sim)));
  }
  if (mark.hp < hp0) hit += 1;
  else faults.push(`seed ${seed}: 12 s of fire out of ${leg.id} never reached ${destName}'s floor`);
}

if (tried === 0) faults.push('no shot was ever fired');
console.log(`legfight: ${hit}/${tried} shots out of a bore reached the platform beyond it`);
for (const f of faults) console.log('  ' + f);
console.log(faults.length ? 'FAIL' : 'PASS');
process.exit(faults.length ? 1 : 0);
