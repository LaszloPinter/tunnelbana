// A ROOF COLUMN IS SOLID WHOEVER THE MOB IS AFTER.
//
// Pursuit across a seam grew its own little movement routine when it landed
// (combat/enemySeam.ts), and that routine walked at the target in a straight
// line. So the moment the player stepped into the tunnel, the station's horde
// stopped caring about its own columns and came through them (from play
// 2026-09-07: "mobs can walk straight through columns if I'm in the tunnel
// not in the station. These are the exact bugs existing from not making the
// leg and the station a world").
//
// The rule: a mob never stands inside a column, whichever room its target is
// in. The two cases have to be the same world.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { putInLegAt } from '../lib/legs.ts';
import { ENEMY_R } from '../../src/combat/types.ts';
import * as C from '../../src/config.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();
const me = sim.me;
const edges = new InputEdges();

const faults: string[] = [];
let stations = 0;
let inside = 0;
let samples = 0;

const safe = () => {
  me.health = 999;
  me.alive = true;
  me.downed = false;
  me.noTrainHitUntil = sim.gameNow + 60_000;
  me.iframesUntil = sim.gameNow + 60_000;
};

for (const name of ALL_STATIONS) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.pillars.length === 0) continue;
  for (const e of [1, -1] as const) {
    const c = corridorsToward(st, e)[0];
    if (!c) continue;
    const leg = sim.ensureLeg(c);
    leg.cleared = true;
    const deep: 1 | -1 = c.a === name ? 1 : -1;
    const mouth = c.a === name ? leg.x0 : leg.x1;
    // the player waits in the bore; the horde is put behind the columns and
    // has to come round them to reach the mouth
    putInLegAt(sim, me, c, mouth + deep * C.M(5), 0);
    sim.hereId = leg.id;
    safe();
    st.enemies.length = 0;
    const host = sim.hostFor(st);
    for (const pl of st.pillars.slice(0, 6)) {
      const cx = (pl.x0 + pl.x1) / 2;
      const cy = (pl.y0 + pl.y1) / 2;
      // behind the column from the mouth, so reaching it means coming round
      spawnEnemy(host, 'runner', { kind: 'world' }, e > 0 ? cx - C.M(4) : cx + C.M(4), cy, true);
    }
    if (st.enemies.length === 0) continue;
    stations += 1;
    for (let k = 0; k < 240; k++) {
      safe();
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      for (const q of st.enemies) {
        samples += 1;
        if (!st.pillarAt(q.x, q.y, ENEMY_R * 0.5)) continue;
        inside += 1;
        faults.push(`${name} e=${e}: a mob stood inside a column while the player was in the bore`);
        break;
      }
      if (faults.length > 0) break;
    }
  }
}

const ok = faults.length === 0;
console.log(
  `solidcolumn: ${stations} platforms with the player through the mouth, ${samples} mob-ticks, ${inside} inside a column / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 6)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
