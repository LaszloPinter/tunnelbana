// PASSENGERS TALK (DESIGN §20): coming near a stranger gets a greeting; E
// beside one asking for a tenner gives it (−10 kr, a gift back); killing
// what was biting one gets thanks and a tip; and all of it the same twice.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { BTN, InputEdges } from '../../src/sim/tick.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { killEnemy } from '../../src/combat/enemyDeath.ts';
import { onPlatform } from '../../src/world/floor.ts';
import { hurtPassenger } from '../../src/sim/passenger.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import { answerPicks } from '../lib/drive.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];

function scene() {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.startRun();
  sim.beginRun();
  const st = asStation(sim.here)!;
  st.enemies.length = 0;
  const me = sim.me;
  const ps = sim.pax.find((q) => q.placeId === st.id && q.kind === 'pendlare')!;
  const edges = new InputEdges();
  const tick = (held = 0) => {
    st.enemies.length = 0;
    me.iframesUntil = sim.gameNow + 10_000;
    sim.runTick(edges.sample(held, 0, 0, me.x + 50, me.y, answerPicks(sim)));
  };
  return { sim, st, me, ps, tick };
}

// ---- a greeting, and a tenner ----
{
  const { me, ps, tick } = scene();
  if (!ps) faults.push('no commuter on the first platform of seed 3');
  else {
    ps.asks = true;
    ps.chatty = true;
    ps.greeted = false;
    me.x = ps.x - C.M(1.5);
    me.y = ps.y;
    for (let k = 0; k < 20; k++) tick();
    if (!ps.say) faults.push('standing beside a stranger, they said nothing');
    me.money = 40;
    me.x = ps.x - C.M(1.5);
    me.y = ps.y;
    tick(BTN.use);
    tick();
    if (!ps.given) faults.push('E beside somebody asking for a tenner gave nothing');
    else if (me.money > 40 - 10) faults.push(`the tenner was not paid (${me.money} kr)`);
    else console.log(`  talk: "${ps.say}", and the tenner changed hands`);
  }
}

// ---- a rescue ----
{
  const { sim, st, me, ps } = scene();
  if (ps) {
    const host = sim.hostFor(st);
    const l = onPlatform(st, ps.x, ps.y)!;
    const e = spawnEnemy(host, 'runner', { kind: 'world' }, l.x + C.M(1), l.y, true);
    hurtPassenger(sim, ps, 5, sim.gameNow);
    const before = me.money;
    killEnemy(host, e, sim.gameNow, me);
    if (me.money <= before) faults.push('killing what bit a passenger paid no thank-you');
    else console.log(`  talk: rescued: "${ps.say}", +${me.money - before} kr`);
  }
}

// ---- the same twice ----
{
  const run = () => {
    const { sim, me, ps, tick } = scene();
    if (ps) {
      me.x = ps.x - C.M(1.5);
      me.y = ps.y;
    }
    for (let k = 0; k < 40 * 60; k++) tick();
    return fingerprint(sim.simState());
  };
  if (run() !== run()) faults.push('the same scene twice says different things');
}

console.log(
  `paxtalk: greetings, a tenner, a rescue tip. The same every time / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;
