// THE JOURNEY CHAIN (sim/chain.ts).
//
// Arriving does not end the run: the exit at the destination BANKS the ride
// and deals the next one from that platform, harder. This stands the party
// at the destination's escalator with money in hand and presses E, and asks:
//   - the ride was banked and counted, the next destination dealt from HERE
//   - the world holds for the card, then runs on
//   - the platform is the horde's again (waves re-armed, bodies on the floor)
//   - a vätte of the second ride is far tougher than one of the first, and
//     some of the pack is smart
//   - cashing out elsewhere keeps the bank plus what is in hand; dying
//     keeps the bank
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import { intoWorld, onPlatform } from '../../src/world/floor.ts';
import { levelIndexFor } from '../../src/sim/stationBuild.ts';
import { nearExit } from '../../src/sim/ground.ts';
import { finalScore } from '../../src/sim/chain.ts';

const faults: string[] = [];
let runs = 0;

for (let seed = 1; seed <= 4; seed++) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const edges = new InputEdges();
  const tick = (held = 0) => sim.runTick(edges.sample(held, 0, 0, me.x + 50, me.y, answerPicks(sim)));
  runs += 1;
  const dest0 = sim.destStation;
  const from0 = sim.station;

  // a first-ride vätte, for the comparison
  const st0 = asStation(sim.here)!;
  const hp0 = spawnEnemy(
    sim.hostFor(st0),
    'runner',
    { kind: 'world' },
    me.x,
    me.y,
    false,
    0,
    1,
    1,
    () => 0.5,
    'plain',
  ).hp;

  // jump to the destination, stand at its exit, with money in hand
  sim.station = dest0;
  const st = asStation(sim.here);
  if (!st) {
    faults.push(`seed ${seed}: ${dest0} is not a station`);
    continue;
  }
  tick();
  const esc = st.escalators[0];
  if (!esc) {
    faults.push(`seed ${seed}: ${dest0} has no escalator`);
    continue;
  }
  const at = intoWorld(st, esc.x, esc.y);
  spawnAt(sim, me, at.x, at.y);
  if (!nearExit(st, me)) {
    faults.push(`seed ${seed}: standing on ${dest0}'s escalator is not "near an exit"`);
    continue;
  }
  me.money = 500;
  me.health = 999;
  const stopsBefore = sim.stopsTraveled;
  void stopsBefore;
  tick(BTN.use);
  if (sim.over) {
    faults.push(`seed ${seed}: the exit at the destination ENDED the run (${sim.over.kind})`);
    continue;
  }
  if (sim.ride !== 1) faults.push(`seed ${seed}: ride count ${sim.ride} after arriving`);
  if (sim.banked <= 0) faults.push(`seed ${seed}: nothing banked with 500 kr in hand`);
  if (sim.rides.length !== 1 || sim.rides[0].to !== dest0 || sim.rides[0].from !== from0)
    faults.push(`seed ${seed}: the ride made reads ${JSON.stringify(sim.rides)}`);
  if (sim.destStation === dest0) faults.push(`seed ${seed}: the next destination is the one we are at`);
  if (!sim.route[0] || sim.route[0].from !== dest0)
    faults.push(`seed ${seed}: the next route does not start here (${sim.route[0]?.from})`);
  if (sim.stopsTraveled !== 0)
    faults.push(`seed ${seed}: stopsTraveled ${sim.stopsTraveled} on a fresh ride`);
  // the next ride starts at the spawn point, not at the exit it came up by
  if (nearExit(st, me)) faults.push(`seed ${seed}: the next ride starts on the exit`);
  const lv = levelIndexFor(st.name, sim.route[0].service.id, sim.route[0].dir);
  if (st.levelIndex !== lv)
    faults.push(`seed ${seed}: the next ride starts on storey ${st.levelIndex}, its train leaves from ${lv}`);
  const local = onPlatform(st, me.x, me.y);
  const isl = st.platforms[0];
  if (
    !local ||
    local.y < isl.top ||
    local.y > isl.bottom ||
    local.x < st.platformX0 ||
    local.x > st.platformX1
  )
    faults.push(`seed ${seed}: the next ride starts off the platform`);
  if (sim.pause?.kind !== 'ride')
    faults.push(`seed ${seed}: the world did not hold for the card (${sim.pause?.kind})`);
  if (st.cleared || st.wave < 1)
    faults.push(`seed ${seed}: ${dest0} was not re-armed (wave ${st.wave}, cleared ${st.cleared})`);
  if (st.enemies.length === 0) faults.push(`seed ${seed}: no horde on the platform for the new ride`);
  // the hold waits for the party: no go, no next ride, however long
  for (let k = 0; k < 600; k++) sim.runTick(edges.sample(0, 0, 0, me.x + 50, me.y, 0));
  if (sim.pause?.kind !== 'ride')
    faults.push(`seed ${seed}: the hold lifted without a go (${sim.pause?.kind})`);
  // ...and go lifts it, on E, which must not also be the exit it stands at
  tick(BTN.use);
  if (sim.pause) faults.push(`seed ${seed}: go did not lift the hold (${sim.pause.kind})`);
  if (sim.ride !== 1) faults.push(`seed ${seed}: the E that said go also took the exit (ride ${sim.ride})`);
  tick();
  // the second ride's vätte
  const hp1 = spawnEnemy(
    sim.hostFor(st),
    'runner',
    { kind: 'world' },
    me.x,
    me.y,
    false,
    0,
    1,
    1,
    () => 0.5,
    'plain',
  ).hp;
  if (hp1 < hp0 * 1.6)
    faults.push(`seed ${seed}: a second-ride vätte has ${hp1} hp against ${hp0} on the first`);
  let smart = 0;
  const N = 40;
  let r = 0.01;
  for (let k = 0; k < N; k++) {
    const e = spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, me.x, me.y, false, 0, 1, 1, () => {
      r = (r + 0.137) % 1;
      return r;
    });
    if (e.smart) smart += 1;
  }
  if (smart === 0) faults.push(`seed ${seed}: none of ${N} second-ride vättar is smart`);
  // cashing out elsewhere keeps the bank and what is in hand
  const banked = sim.banked;
  me.money = 200;
  sim.finishRun('extract', '');
  const score = finalScore(sim, sim.gameNow);
  if (score < banked + 100)
    faults.push(`seed ${seed}: cashing out with ${banked} banked and 200 kr scored ${score}`);
  // dying keeps the bank, and what was carried counts as it does cashing
  // out (sim/chain.ts finalScore, from play 2026-10-15)
  sim.over = { kind: 'died', reason: 'test' };
  const died = finalScore(sim, sim.gameNow);
  if (died < banked + 100 || died !== score)
    faults.push(
      `seed ${seed}: dying with ${banked} banked and 200 kr scored ${died} (cashing out: ${score})`,
    );
}

const ok = faults.length === 0;
console.log(
  `chain2d: ${runs} runs banked a ride at the destination and were dealt the next, harder / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 10)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
