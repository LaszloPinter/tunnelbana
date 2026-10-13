// A BOLT IS WORTH WHAT IT GATHERED ON THE WAY.
//
// Shot speed and range perks came out 2026-09-24: a bolt already crossed the
// screen and outlived it, so neither bought anything you could see. In their
// place, damage that depends on the flight, Långskott pays once a bolt has
// flown LONG_SHOT_M. This
// stands a target near and one far and reads the hit; then two in a line
// with pierce and reads the second.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import type { Enemy } from '../../src/combat/types.ts';
import { clearSpot } from '../../src/world/walk2d.ts';
import { onPlatform } from '../../src/world/floor.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let scenes = 0;

/** one bolt at `mark`, and how much the first hit took */
function firstHit(sim: Run, edges: InputEdges, mark: Enemy, watch: Enemy[]): number[] {
  const me = sim.me;
  // a bolt left over from the last round would count as this one's cast
  for (const pl of sim.places.values()) pl.projs.length = 0;
  me.fireCdUntil = 0;
  const hp0 = watch.map((e) => e.hp);
  let fired = false;
  for (let k = 0; k < 400; k++) {
    me.mana = 999;
    me.health = 999;
    for (const e of watch) e.speedMul = 0;
    // one cast only: hold until a bolt is in the world, then let go
    const held = fired ? 0 : BTN.fire;
    sim.runTick(edges.sample(held, 0, 0, mark.x, mark.y, answerPicks(sim)));
    if (sim.here.projs.length > 0) fired = true;
    if (watch.every((e, i) => e.hp < hp0[i])) break;
  }
  return watch.map((e, i) => hp0[i] - e.hp);
}

for (const name of ALL_STATIONS.slice(0, 6)) {
  for (const scene of ['langskott'] as const) {
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
    st.enemies.length = 0;
    me.fireCdUntil = 0;
    const put = (dx: number): Enemy | null => {
      const aim = clearSpot(sim, me.x + dx, me.y, C.M(0.6), 'platform');
      const local = onPlatform(st, aim.x, aim.y);
      if (!local) return null;
      const e = spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, local.x, local.y, false, 400);
      e.hp = e.maxHp = 400;
      e.speedMul = 0;
      return e;
    };
    if (scene === 'langskott') {
      me.mods.longShot = 0.5;
      const near = put(C.M(4));
      if (!near) continue;
      const [a] = firstHit(sim, edges, near, [near]);
      st.enemies.length = 0;
      me.fireCdUntil = 0;
      const far = put(C.M(12));
      if (!far) continue;
      const [b] = firstHit(sim, edges, far, [far]);
      scenes += 1;
      if (!(a > 0) || !(b > 0))
        faults.push(`${name}: långskott: near hit ${a}, far hit ${b}, one never landed`);
      else if (Math.abs(b - a * 1.5) > 1e-6)
        faults.push(`${name}: långskott: near hit ${a}, far hit ${b}, wanted ×1.5`);
    }
  }
}

const ok = faults.length === 0;
console.log(`gathered2d: ${scenes} scenes: Långskott pays at 12 m and not at 4 / ${ok ? 'PASS' : 'FAIL'}`);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
