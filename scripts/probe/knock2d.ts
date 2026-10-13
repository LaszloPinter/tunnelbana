// KNOCKBACK ON THE MAP: the shove the perks promise is a shove you can see.
//
// From play 2026-09-17: "I suspect knockback perk never triggers". Panic Wave
// (retaliate) shoves everything near you when you are bitten; the torrent
// shoves what it sprays. Both go through applyKnock and the map's knock
// integrator (combat/enemyMap.ts). This bites a player who holds the perk at
// 100%, and sprays a vätte, and asks that the body MOVED.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { clearSpot } from '../../src/world/walk2d.ts';
import { onPlatform } from '../../src/world/floor.ts';
import { dist } from '../../src/sim/det.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let scenes = 0;

for (const name of ALL_STATIONS.slice(0, 5)) {
  // ---- Panic Wave: bitten, and the biter is thrown
  {
    const sim = new Run(NULL_HOST);
    sim.seedPinned = true;
    sim.runSeed = 2;
    sim.station = name;
    sim.startRun();
    sim.beginRun();
    const me = sim.me;
    const st = asStation(sim.here);
    if (!st) continue;
    scenes += 1;
    me.mods.retaliate = 1;
    st.enemies.length = 0;
    const spot = clearSpot(sim, me.x + C.M(1.2), me.y, C.M(0.6), 'platform');
    const local = onPlatform(st, spot.x, spot.y);
    if (!local) {
      faults.push(`${name}: no deck beside the player`);
      continue;
    }
    const e = spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, local.x, local.y, true, 400);
    const edges = new InputEdges();
    const hp0 = me.health;
    let bitAt = -1;
    let x0 = 0;
    let y0 = 0;
    for (let k = 0; k < 240; k++) {
      me.iframesUntil = 0;
      if (bitAt < 0) {
        x0 = e.x;
        y0 = e.y;
      }
      sim.runTick(edges.sample(0, 0, 0, me.x + 50, me.y, answerPicks(sim)));
      if (bitAt < 0 && me.health < hp0) bitAt = k;
      if (bitAt >= 0 && k > bitAt + 30) break;
    }
    if (bitAt < 0) faults.push(`${name}: a vätte beside the player never bit in 4 s`);
    else {
      const moved = dist(e.x - x0, e.y - y0);
      if (moved < C.M(1) && e.hp > 0)
        faults.push(
          `${name}: Panic Wave fired on the bite but the biter moved ${(moved / C.PX_PER_M).toFixed(2)} m`,
        );
    }
  }
  // ---- the torrent's spray shoves
  {
    const sim = new Run(NULL_HOST);
    sim.seedPinned = true;
    sim.runSeed = 2;
    sim.station = name;
    sim.startRun();
    sim.beginRun();
    const me = sim.me;
    const st = asStation(sim.here);
    if (!st) continue;
    scenes += 1;
    me.weapon = 'smg';
    st.enemies.length = 0;
    const spot = clearSpot(sim, me.x + C.M(3), me.y, C.M(0.6), 'platform');
    const local = onPlatform(st, spot.x, spot.y);
    if (!local) {
      faults.push(`${name}: no deck three metres out`);
      continue;
    }
    const e = spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, local.x, local.y, false, 400);
    e.hp = e.maxHp = 9999;
    const x0 = e.x;
    const edges = new InputEdges();
    for (let k = 0; k < 90; k++) {
      me.mana = 999;
      e.speedMul = 0;
      e.hitCdUntil = sim.gameNow + 10_000;
      sim.runTick(edges.sample(BTN.fire, 0, 0, e.x, e.y, answerPicks(sim)));
    }
    const pushed = e.x - x0;
    if (pushed < C.M(0.8))
      faults.push(
        `${name}: a second and a half of torrent pushed the target ${(pushed / C.PX_PER_M).toFixed(2)} m`,
      );
  }
}

const ok = faults.length === 0;
console.log(
  `knock2d: ${scenes} scenes: Panic Wave throws the biter, the torrent shoves its target / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 10)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
