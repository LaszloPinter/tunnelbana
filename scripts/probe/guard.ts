// PASSENGERS, STAGE 1 (DESIGN §20): Väktaren on a platform.
//
// A guard put down on a platform with the horde at his feet must fight it
// (the runners lose hp, some die, and no seat is credited with his kills),
// must be bitten by it and die for good (gone from run.pax), must never be
// hurt by the player's bolts, and the same scene run twice must hash the
// same, a passenger is simulation state like any other.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { BTN, InputEdges } from '../../src/sim/tick.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { spawnPassenger } from '../../src/sim/passenger.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];

function scene() {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.startRun();
  sim.beginRun();
  const st = asStation(sim.here)!;
  const host = sim.hostFor(st);
  // the platform's own horde is cleared: this probe brings its own
  st.enemies.length = 0;
  const isl = st.platforms[0];
  const lx = (st.platformX0 + st.platformX1) / 2 + C.M(20);
  const ly = (isl.top + isl.bottom) / 2;
  const at = fromPlatform(st, lx, ly);
  const guard = spawnPassenger(sim, 'vaktare', st.id, at.x, at.y, 7);
  const me = sim.me;
  me.health = 9999;
  me.maxHealth = 9999;
  const edges = new InputEdges();
  const tick = (held = 0, aim = { x: me.x + 50, y: me.y }) => {
    me.iframesUntil = sim.gameNow + 10_000;
    sim.runTick(edges.sample(held, 0, 0, aim.x, aim.y, 0));
  };
  return { sim, st, host, guard, lx, ly, tick, me };
}

// ---- he fights: three runners at his feet ----
{
  const { sim, st, host, guard, lx, ly, tick, me } = scene();
  const runners = [0, 1, 2].map((i) =>
    spawnEnemy(host, 'runner', { kind: 'world' }, lx + C.M(1.5), ly + C.M(i - 1), false),
  );
  const hp0 = runners.reduce((a, e) => a + e.hp, 0);
  const kills0 = me.kills;
  const xp0 = sim.party.xp + sim.party.level * 1000;
  for (let k = 0; k < 6 * 60; k++) tick();
  const left = runners.filter((e) => e.hp > 0 && st.enemies.includes(e));
  const hp1 = left.reduce((a, e) => a + e.hp, 0);
  if (guard.swingAt < 0) faults.push('the guard never swung');
  if (hp1 >= hp0) faults.push(`the runners lost nothing to the guard (${hp0} → ${hp1})`);
  if (left.length === 3) faults.push('the guard killed none of three runners in six seconds');
  if (me.kills !== kills0)
    faults.push(`the guard's kills were credited to the player (${kills0} → ${me.kills})`);
  if (left.length < 3 && sim.party.xp + sim.party.level * 1000 <= xp0)
    faults.push('the guard killed but the party got no xp');
  console.log(
    `  guard: swung, runners ${hp0} → ${hp1} hp, ${3 - left.length} dead, guard at ${guard.hp}/${guard.maxHp}`,
  );
}

// ---- he dies for good ----
{
  const { sim, host, guard, lx, ly, tick } = scene();
  guard.hp = 12;
  for (let i = 0; i < 6; i++)
    spawnEnemy(host, 'runner', { kind: 'world' }, lx + C.M(1), ly + C.M(i - 3) * 0.4, true);
  let k = 0;
  for (; k < 10 * 60 && guard.alive; k++) tick();
  if (guard.alive) faults.push('six runners on a 12-hp guard for ten seconds, and he lives');
  if (sim.pax.includes(guard)) faults.push('a dead guard is still in run.pax');
  else console.log(`  guard: bitten to death in ${(k / 60).toFixed(1)} s, gone from run.pax`);
}

// ---- the player's bolts pass through him ----
{
  const { guard, tick, me, st } = scene();
  // stand ten metres from him and fire at him for three seconds, on a
  // platform kept empty, the station's own waves would bite him
  const hp = guard.hp;
  const aim = { x: guard.x, y: guard.y };
  me.x = guard.x - C.M(6);
  me.y = guard.y;
  let shots = 0;
  for (let k = 0; k < 3 * 60; k++) {
    st.enemies.length = 0;
    tick(k % 20 < 10 ? BTN.fire : 0, aim);
    shots = Math.max(shots, st.projs.filter((p) => p.friendly).length);
  }
  if (shots === 0) faults.push('the bolt test fired nothing: it proves nothing');
  if (guard.hp !== hp) faults.push(`the player's bolts hurt the guard (${hp} → ${guard.hp})`);
  else console.log('  guard: three seconds of bolts aimed at him, not a scratch');
}

// ---- the same scene twice hashes the same ----
{
  const run = () => {
    const { sim, host, lx, ly, tick } = scene();
    for (let i = 0; i < 4; i++)
      spawnEnemy(host, 'runner', { kind: 'world' }, lx + C.M(2), ly + C.M(i - 2), false);
    for (let k = 0; k < 4 * 60; k++) tick();
    return fingerprint(sim.simState());
  };
  const a = run();
  const b = run();
  if (a !== b) faults.push(`two runs of the same scene part ways (${a} vs ${b})`);
}

console.log(
  `guard: Väktaren fights, dies for good, and is never the player's target / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;
