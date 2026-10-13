// A SHOT HITS WHAT IT IS POINTED AT, ANYWHERE IN A LEG. Stand a walker at a
// spread of depths down a tunnel, put one vätte nine metres in front of them
// along the bore, hold the trigger, and check it dies. In the old world a
// bolt became the neighbour's at the leg's halfway mark while the horde
// chasing you did not, so from mid-tunnel onward every shot went straight
// through (from play 2026-09-06). On the map there is no halfway mark to get
// wrong, the probe asks the same question of the one world (2026-09-15).
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { corridorToward } from '../../src/sim/places.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { fromLeg } from '../../src/world/floor.ts';
import type { Variant } from '../../src/combat/types.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;

for (const seed of [1, 2, 3]) {
  for (const frac of [0.15, 0.35, 0.5, 0.65, 0.85]) {
    for (const variant of ['plain', 'stone', 'quick'] as Variant[]) {
      const sim = new Run(NULL_HOST);
      sim.seedPinned = true;
      sim.runSeed = seed;
      sim.startRun();
      sim.beginRun();
      goFlat(sim);
      const me = sim.me;
      const edges = new InputEdges();
      const st = asStation(sim.here);
      const c = st && (corridorToward(st, 1) ?? corridorToward(st, -1));
      if (!st || !c) continue;
      const leg = sim.ensureLeg(c);
      leg.cleared = true;
      // the walker on the bore's centreline, so far down it, on the map
      const s0 = c.s0 + (c.s1 - c.s0) * frac;
      const at = fromLeg(leg, s0, 0);
      me.x = at.x;
      me.y = at.y;
      me.placeId = leg.id;
      sim.hereId = leg.id;
      // the target stands on the LEG's floor, nine metres along the bore:
      // named in the bore's own arc, said on the map by spawnEnemy
      const host = sim.hostFor(leg);
      const target = fromLeg(leg, s0 + C.M(9), 0);
      const e = spawnEnemy(
        host,
        'runner',
        { kind: 'world' },
        s0 + C.M(9),
        0,
        false,
        0,
        1,
        1,
        undefined,
        variant,
      );
      e.ofTunnel = true;
      e.aggro = false;
      tried += 1;
      let killed = -1;
      for (let t = 0; t < 60 * 12 && e.hp > 0; t++) {
        me.health = 999;
        me.mana = 999;
        me.noTrainHitUntil = sim.gameNow + 9000;
        me.iframesUntil = sim.gameNow + 9000;
        // pin the target: this probe is about the bolt, not the chase
        e.x = target.x;
        e.y = target.y;
        e.speedMul = 0;
        sim.runTick(edges.sample(BTN.fire, 0, 0, e.x, e.y, answerPicks(sim)));
        if (e.hp <= 0) killed = t;
      }
      if (killed < 0)
        faults.push(
          `seed ${seed} ${(frac * 100).toFixed(0)}% down the leg: a ${variant} vätte survived 12 s of fire at 9 m`,
        );
    }
  }
}

if (tried === 0) faults.push('no tunnel target was ever placed');
console.log(`legshots: ${tried} tunnel targets, ${faults.length} unkillable`);
for (const f of faults.slice(0, 10)) console.log('  ' + f);
console.log(faults.length ? 'FAIL' : 'PASS');
process.exit(faults.length ? 1 : 0);
