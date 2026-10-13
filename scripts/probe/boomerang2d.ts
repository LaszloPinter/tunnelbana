// DARK II COMES BACK. A caster with the boomerang fires away from everything,
// at the platform's far wall; the bolt must not die there but turn for home
// and be taken in, off the floor's edge, a column, a car, whatever stopped
// it. It only ever returned when a bolt outlived its clock, which one never
// did (from play 2026-09-16: "boomerang never happens").
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import * as C from '../../src/config.ts';
import { laneMods } from '../../src/core/lanes.ts';

const faults: string[] = [];
let tried = 0;
let came = 0;

for (const name of ALL_STATIONS.slice(0, 6)) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 2;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  sim.hereId = sim.ensurePlace(name).id;
  for (const p of sim.players) p.placeId = sim.hereId;
  const st = asStation(sim.here);
  if (!st || st.platforms.length === 0) continue;
  const me = sim.me;
  const isl = st.platforms[0];
  const at = fromPlatform(st, (st.platformX0 + st.platformX1) / 2, (isl.top + isl.bottom) / 2);
  // clear of the roof columns: a bolt that meets one beside you comes
  // straight back to the hand, which is right, and not what is measured here
  spawnAt(sim, me, at.x, at.y);
  // as the lane grants it (core/lanes.ts): the pierce comes with it, or a
  // bolt with none turns for home the moment it leaves the hand
  laneMods(me.mods, 'dark', 2);
  const edges = new InputEdges();
  // aim across the platform, at the wall beyond the far bed: nothing there
  const wall = fromPlatform(st, (st.platformX0 + st.platformX1) / 2, st.worldTopY - C.M(10));
  tried += 1;
  let returned = false;
  let taken = false;
  let bolts = 0;
  for (let t = 0; t < 60 * 6; t++) {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    me.health = 999;
    me.mana = 999;
    me.iframesUntil = sim.gameNow + 60_000;
    // hold the trigger until one bolt is out, then hold still and watch it
    sim.runTick(edges.sample(bolts === 0 ? BTN.fire : 0, 0, 0, wall.x, wall.y, answerPicks(sim)));
    const mine = [...sim.places.values()]
      .flatMap((pl) => pl.projs)
      // the caster's own: a passenger's smällare is friendly too (DESIGN §20)
      .filter((p) => p.friendly && p.owner === me.id);
    bolts = Math.max(bolts, mine.length);
    if (mine.some((p) => p.returning)) returned = true;
    if (returned && mine.length === 0) {
      taken = true;
      break;
    }
  }
  if (bolts === 0) faults.push(`${name}: never cast a bolt`);
  else if (!returned) faults.push(`${name}: the bolt died at the wall and never turned for home`);
  else if (!taken) faults.push(`${name}: the bolt turned for home but was never taken in`);
  else came += 1;
}

if (tried === 0) faults.push('no station was tried');
console.log(`boomerang2d: ${came}/${tried} bolts came back to the hand / ${faults.length ? 'FAIL' : 'PASS'}`);
for (const f of faults) console.log('  ' + f);
process.exit(faults.length ? 1 : 0);
