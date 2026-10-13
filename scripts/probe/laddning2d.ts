// LADDNING: THREE HITS, AND THE PACK GOES OFF.
//
// The charge lane (combat/charge.ts): every hit charges the body, the third
// detonates it, and a body that dies pops its charges onto its neighbours,
// which is what keeps the lane alive where everything dies in one hit.
// Two scenes on one deck:
//   1. a tank with two neighbours a metre off its line: three bolts into the
//      tank, and the neighbours, never hit by a bolt, bleed from the blast
//   2. three one-hit vättar round a tank: killing them pops charges onto
//      the tank, and the third pop detonates it
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { fromPlatform, onPlatform } from '../../src/world/floor.ts';
import { laneMods } from '../../src/core/lanes.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let scenes = 0;

function setUp(name: string, tier: 0 | 1 | 2) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 4;
  sim.station = name;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const st = asStation(sim.here);
  if (!st) return null;
  if (tier > 0) laneMods(me.mods, 'laddning', tier);
  st.enemies.length = 0;
  // nobody else in the scene: a guard on the platform would hit the pack too (DESIGN §20)
  sim.pax.length = 0;
  const host = sim.hostFor(st);
  // ALONG THE PLATFORM, not along the map's x: a platform lies at its own
  // bearing, and "six metres east" of the player can be off the deck
  const here = onPlatform(st, me.x, me.y);
  if (!here) return null;
  const put = (dx: number, dy: number, hp: number, kind: 'runner' | 'troll' = 'runner') => {
    const local = { x: here.x + dx, y: here.y + dy };
    const w = fromPlatform(st, local.x, local.y);
    if (sim.map.at(w.x, w.y)?.kind !== 'platform' || sim.map.blocked(w.x, w.y, C.M(0.5))) return null;
    const e = spawnEnemy(host, kind, { kind: 'world' }, local.x, local.y, false, 0, 1, 1, () => 0.5, 'plain');
    e.hp = e.maxHp = hp;
    e.speedMul = 0;
    return e;
  };
  return { sim, me, st, put };
}

const hold = (sim: Run, ...es: { speedMul: number; hitCdUntil: number }[]) => {
  sim.me.mana = 999;
  sim.me.health = 999;
  for (const e of es) {
    e.speedMul = 0;
    e.hitCdUntil = sim.gameNow + 60_000;
  }
};

for (const name of ALL_STATIONS.slice(0, 5)) {
  for (const tier of [0, 1] as const) {
    // ---- 1. three bolts into a tank, the neighbours off the line
    const s = setUp(name, tier);
    if (!s) continue;
    const tank = s.put(C.M(5), 0, 400);
    const a = s.put(C.M(5), C.M(1.9), 400);
    const b = s.put(C.M(5), -C.M(1.9), 400);
    if (!tank || !a || !b) {
      faults.push(`${name}: could not stand the trio on the deck`);
      continue;
    }
    if (tier === 1) scenes += 1;
    const edges = new InputEdges();
    let shots = 0;
    for (let k = 0; k < 400 && shots < 3; k++) {
      hold(s.sim, tank, a, b);
      const hp = tank.hp;
      s.sim.runTick(edges.sample(BTN.fire, 0, 0, tank.x, tank.y, answerPicks(s.sim)));
      if (tank.hp < hp) shots += 1;
    }
    for (let k = 0; k < 5; k++) {
      hold(s.sim, tank, a, b);
      s.sim.runTick(edges.sample(0, 0, 0, tank.x, tank.y, answerPicks(s.sim)));
    }
    const bled = a.hp < a.maxHp || b.hp < b.maxHp;
    if (shots < 3) faults.push(`${name}: could not land three bolts on the tank (${shots})`);
    else if (tier === 0 && bled)
      faults.push(`${name}: without the lane the neighbours bled (${a.hp}, ${b.hp})`);
    else if (tier === 1 && !bled)
      faults.push(`${name}: three hits on the tank did not detonate onto the neighbours`);
    else if (tier === 1 && tank.charge !== 0)
      faults.push(`${name}: the tank kept ${tank.charge} charges after going off`);
  }
  // ---- 2. kills pop charges onto the tank
  {
    const s = setUp(name, 1);
    if (!s) continue;
    scenes += 1;
    const tank = s.put(C.M(5), 0, 400);
    const fodder = [s.put(C.M(4), C.M(1.2), 1), s.put(C.M(6), C.M(1.2), 1), s.put(C.M(5), -C.M(1.5), 1)];
    if (!tank || fodder.some((f) => !f)) {
      faults.push(`${name}: could not stand the fodder round the tank`);
      continue;
    }
    const edges = new InputEdges();
    for (const f of fodder) {
      for (let k = 0; k < 300 && f!.hp > 0; k++) {
        hold(s.sim, tank, ...(fodder as { speedMul: number; hitCdUntil: number }[]));
        s.sim.runTick(edges.sample(BTN.fire, 0, 0, f!.x, f!.y, answerPicks(s.sim)));
      }
      // a body takes one charge per 300 ms (combat/charge.ts): let the pop land
      for (let k = 0; k < 25; k++) {
        hold(s.sim, tank, ...(fodder as { speedMul: number; hitCdUntil: number }[]));
        s.sim.runTick(edges.sample(0, 0, 0, tank.x, tank.y, answerPicks(s.sim)));
      }
    }
    if (fodder.some((f) => f!.hp > 0)) faults.push(`${name}: could not kill the fodder`);
    else if (tank.hp >= tank.maxHp)
      faults.push(`${name}: three kills beside the tank did not detonate it (charge ${tank.charge})`);
  }
}

const ok = faults.length === 0 && scenes > 0;
console.log(
  `laddning2d: ${scenes} scenes: three hits detonate onto the pack, three kills pop it off / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
