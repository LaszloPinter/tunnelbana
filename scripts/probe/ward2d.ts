// THE ELITE'S WARD, AND STÖT.
//
// An elite goes in front holding a ward toward you; the vätte crowding
// behind it cannot be hit until the ward is broken (from play 2026-09-17:
// "Ward needs to be broken before enemies behind can be hit. Pierce doesn't
// work (ward stops it)"). And STÖT, the press
// that replaced the player's own ward, throws everything around you back
// and shatters a ward in reach.
//
// Three scenes on one deck, an elite six metres out and a plain one two
// metres behind it:
//   1. piercing bolts: the one behind is unhurt while the ward stands (a
//      pierce stops on it), the ward wears down, and once it breaks the
//      pierce carries on into the one behind
//   3. STÖT: mana is spent, the cooldown set, the elite thrown and its ward
//      gone, and the one two metres past its reach untouched
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { fromPlatform, onPlatform } from '../../src/world/floor.ts';
import { dist } from '../../src/sim/det.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let scenes = 0;

type Scene = 'bolts' | 'stot';

function setUp(name: string, scene: Scene) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 3;
  sim.station = name;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const st = asStation(sim.here);
  if (!st) return null;
  if (scene === 'bolts') me.mods.pierce += 5;
  // heavier bolts, so the ward breaks well inside the window whatever the deck's spread
  me.mods.bulletDamage += 2;
  // along the platform's own axis: a deck lies at its bearing, and six
  // metres along the map's x can be off it
  const here = onPlatform(st, me.x, me.y);
  if (!here) return null;
  const lf = { x: here.x + C.M(6), y: here.y };
  const lb = { x: here.x + C.M(8), y: here.y };
  for (const l of [lf, lb]) {
    const wp = fromPlatform(st, l.x, l.y);
    if (sim.map.at(wp.x, wp.y)?.kind !== 'platform' || sim.map.blocked(wp.x, wp.y, C.M(0.6))) return null;
  }
  st.enemies.length = 0;
  // nobody else in the scene: a passenger would punch the ward too (DESIGN §20)
  sim.pax.length = 0;
  const host = sim.hostFor(st);
  const elite = spawnEnemy(host, 'runner', { kind: 'world' }, lf.x, lf.y, false, 400);
  const plain = spawnEnemy(host, 'runner', { kind: 'world' }, lb.x, lb.y, false, 400);
  if (!elite || !plain) return null;
  elite.variant = 'elite';
  elite.ward = { hp: C.WARD_HP, max: C.WARD_HP, angle: 0 };
  elite.hp = elite.maxHp = 400;
  plain.hp = plain.maxHp = 400;
  return { sim, me, st, elite, plain };
}

function hold(s: NonNullable<ReturnType<typeof setUp>>) {
  s.me.mana = 999;
  s.me.health = 999;
  s.elite.speedMul = 0;
  s.plain.speedMul = 0;
  s.elite.hitCdUntil = s.sim.gameNow + 10_000;
  s.plain.hitCdUntil = s.sim.gameNow + 10_000;
}

for (const name of ALL_STATIONS.slice(0, 4)) {
  // ---- 1. bolts against the ward
  {
    const s = setUp(name, 'bolts');
    if (!s) continue;
    scenes += 1;
    const edges = new InputEdges();
    let brokeAt = -1;
    let hurtBehindEarly = false;
    let hurtBehindLate = false;
    for (let k = 0; k < 900; k++) {
      hold(s);
      s.sim.runTick(edges.sample(BTN.fire, 0, 0, s.plain.x, s.plain.y, answerPicks(s.sim)));
      const wardUp = (s.elite.ward?.hp ?? 0) > 0;
      if (!wardUp && brokeAt < 0) brokeAt = k;
      if (s.plain.hp < s.plain.maxHp) {
        if (brokeAt < 0) hurtBehindEarly = true;
        else hurtBehindLate = true;
      }
      if (hurtBehindLate) break;
    }
    if (hurtBehindEarly) faults.push(`${name}: a pierce went through the ward while it stood`);
    if (brokeAt < 0) faults.push(`${name}: 900 ticks of bolts never broke a ${C.WARD_HP} hp ward`);
    else if (!hurtBehindLate)
      faults.push(`${name}: the ward broke at tick ${brokeAt} but the one behind stayed unhurt`);
  }
  // ---- 3. STÖT
  {
    const s = setUp(name, 'stot');
    if (!s) continue;
    scenes += 1;
    const edges = new InputEdges();
    hold(s);
    s.me.mana = 100;
    const x0 = s.elite.x;
    s.sim.runTick(edges.sample(BTN.ult, 0, 0, s.plain.x, s.plain.y, answerPicks(s.sim)));
    if (s.me.mana > 100 - C.NOVA_COST + 1) faults.push(`${name}: STÖT cost no mana (${s.me.mana})`);
    if (s.me.nextNovaAt <= s.sim.gameNow) faults.push(`${name}: STÖT set no cooldown`);
    if ((s.elite.ward?.hp ?? 0) > 0) faults.push(`${name}: STÖT left the elite's ward standing`);
    if (s.elite.hp >= s.elite.maxHp) faults.push(`${name}: STÖT did not hurt the elite`);
    if (s.plain.hp < s.plain.maxHp)
      faults.push(`${name}: STÖT reached two metres past its ${C.NOVA_RADIUS / C.PX_PER_M} m`);
    for (let k = 0; k < 30; k++) {
      s.elite.hitCdUntil = s.sim.gameNow + 10_000;
      s.plain.hitCdUntil = s.sim.gameNow + 10_000;
      s.sim.runTick(edges.sample(0, 0, 0, s.plain.x, s.plain.y, answerPicks(s.sim)));
    }
    if (dist(s.elite.x - x0, 0) < C.M(0.5))
      faults.push(
        `${name}: STÖT did not throw the elite back (moved ${(Math.abs(s.elite.x - x0) / C.PX_PER_M).toFixed(2)} m)`,
      );
    hold(s);
    const mana1 = s.me.mana;
    s.sim.runTick(edges.sample(BTN.ult, 0, 0, s.plain.x, s.plain.y, answerPicks(s.sim)));
    if (s.me.mana < mana1) faults.push(`${name}: a second STÖT fired inside the cooldown`);
  }
}

const ok = faults.length === 0;
console.log(`ward2d: ${scenes} scenes: the ward stops bolts, STÖT shatters it / ${ok ? 'PASS' : 'FAIL'}`);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
