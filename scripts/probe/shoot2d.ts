// A SHOT CROSSES THE MAP AND HITS SOMETHING.
//
// A bolt used to live "as far as its room and a little past it", and past
// that it was handed to the next place. A room's ends are a PLATFORM'S OWN
// SPAN, numbers in that station's plan, so once a body's position meant a
// point on the map instead, every shot was out of bounds on the tick it was
// fired and died before it was drawn (from play 2026-09-10: "I can shoot but
// the projectiles are invisible").
//
// On the map a bolt flies until it hits something or runs off the ground.
// This fires at a vatte standing a few metres away and asks that it bleeds.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { clearSpot } from '../../src/world/walk2d.ts';
import { onPlatform } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let hit = 0;
let flew = 0;

for (const name of ALL_STATIONS.slice(0, 10)) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.station = name;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const edges = new InputEdges();
  const st = asStation(sim.here);
  if (!st) continue;
  tried += 1;

  // a target a few metres along the deck, clear of the furniture
  const aim = clearSpot(sim, me.x + C.M(6), me.y, C.M(0.6), 'platform');
  st.enemies.length = 0;
  const local = onPlatform(st, aim.x, aim.y);
  if (!local) {
    faults.push(`${name}: the aiming point is not on the platform at all`);
    continue;
  }
  spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, local.x, local.y, false, 400);
  const mark = st.enemies[0];
  if (!mark) {
    faults.push(`${name}: could not put a target on its own deck`);
    continue;
  }
  mark.speedMul = 0;
  const hp0 = mark.hp;
  let sawProj = false;
  for (let k = 0; k < 400 && mark.hp === hp0; k++) {
    me.mana = 999;
    me.health = 999;
    mark.speedMul = 0;
    sim.runTick(edges.sample(BTN.fire, 0, 0, mark.x, mark.y, answerPicks(sim)));
    if (st.projs.length > 0) sawProj = true;
  }
  if (sawProj) flew += 1;
  else faults.push(`${name}: firing made no bolt at all`);
  if (mark.hp < hp0) hit += 1;
  else if (sawProj) faults.push(`${name}: bolts flew but never reached a target six metres away`);
  // A RUN THAT NEVER FIRED IS A FAULT, not a run with nothing to say: with
  // neither branch above taken this counted as tried and passed.
  else faults.push(`${name}: never put a bolt in the world`);
}

const ok = faults.length === 0;
console.log(
  `shoot2d: ${flew}/${tried} runs put a bolt in the world, ${hit} of them drew blood at six metres / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 6)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
