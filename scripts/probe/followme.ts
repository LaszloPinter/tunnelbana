// THE HORDE'S ATTENTION DOES NOT STOP AT A MOUTH.
//
// A place's fight only ever knew the seats standing IN it, so the seam was an
// invisible line the horde switched off at: step into the bore and the
// platform's mobs forgot you mid-stride, step back and the tunnel's did.
// Nothing followed anyone anywhere, `chaseOn`, which has always known how to
// hand a mob across, was not reachable from combat and never once ran (from
// play 2026-09-07: "mobs aggro me when I step over an invisible line and then
// lose interest immediately as soon as I step back behind that invisible
// line. They should be able to follow me into the tunnel").
//
// The rule, both ways: a mob standing near a mouth with the player just
// through it comes after them, and arrives in the room the player is in.
//
// On the map (2026-09-15) both bodies are put down in Stockholm, the bore's
// arc and the platform's along-and-across said on the map, and "arrives in
// the room" is the ground under the mob changing hands (world/metal.ts).
import * as C from '../../src/config.ts';
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { fromLeg, fromPlatform } from '../../src/world/floor.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();
goFlat(sim);
const me = sim.me;
const edges = new InputEdges();

const faults: string[] = [];
let tried = 0;
let crossed = 0;
let worstMs = 0;

const safe = () => {
  me.health = 999;
  me.alive = true;
  me.downed = false;
  me.noTrainHitUntil = sim.gameNow + 60_000;
  me.iframesUntil = sim.gameNow + 60_000;
};

// eight seams is plenty: the rule is about the seam, not about the station
for (const name of ALL_STATIONS.slice(0, 12)) {
  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0) continue;
  for (const e of [1, -1] as const) {
    const c = corridorsToward(st, e)[0];
    if (!c) continue;
    const leg = sim.ensureLeg(c);
    leg.cleared = true;
    const deep: 1 | -1 = c.a === name ? 1 : -1;
    const mouth = c.a === name ? c.s0 : c.s1;
    const deckY = (st.platforms[0].top + st.platforms[0].bottom) / 2;
    const endX = e > 0 ? st.platformX1 - C.M(3) : st.platformX0 + C.M(3);

    for (const dir of ['in', 'out'] as const) {
      leg.enemies.length = 0;
      st.enemies.length = 0;
      tried += 1;
      me.frame = { kind: 'world' };
      let watching;
      if (dir === 'in') {
        // player a few metres into the bore, mob just inside the platform
        const at = fromLeg(leg, mouth + deep * C.M(6), 0);
        me.x = at.x;
        me.y = at.y;
        me.placeId = leg.id;
        sim.hereId = leg.id;
        spawnEnemy(sim.hostFor(st), 'runner', { kind: 'world' }, endX, deckY, false);
        watching = { from: st, to: leg };
      } else {
        // ...and the other way: player on the platform, mob just inside the bore
        const at = fromPlatform(st, endX, deckY);
        me.x = at.x;
        me.y = at.y;
        me.placeId = st.id;
        sim.hereId = st.id;
        spawnEnemy(sim.hostFor(leg), 'runner', { kind: 'world' }, mouth + deep * C.M(4), 0, false);
        watching = { from: leg, to: st };
      }
      safe();
      const mob = watching.from.enemies[0];
      if (!mob) {
        faults.push(`${name} e=${e} ${dir}: no mob could be put down`);
        continue;
      }
      const startAt = sim.gameNow;
      let landed = false;
      for (let k = 0; k < 600; k++) {
        safe();
        sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
        if (watching.to.enemies.some((q) => q.id === mob.id)) {
          landed = true;
          break;
        }
        if (mob.hp <= 0) break;
      }
      const took = sim.gameNow - startAt;
      if (landed) {
        crossed += 1;
        worstMs = Math.max(worstMs, took);
      } else if (mob.hp > 0) {
        faults.push(`${name} e=${e} ${dir}: the mob never crossed to reach the player`);
      }
    }
  }
}

if (tried === 0) faults.push('no seam was ever tried');
const ok = faults.length === 0;
console.log(
  `followme: ${tried} mobs beside a seam with the player through it, ${crossed} followed (worst ${(worstMs / 1000).toFixed(1)} s) / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
