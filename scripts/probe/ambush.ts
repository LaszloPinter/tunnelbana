// THE TUNNEL ANSWERS ONCE. Deep enough into a bore on foot, an ambush springs,
// half of it ahead of you, half behind, none of it inside 45 m where it
// would pop into being on screen, and it springs ONCE: the leg remembers.
// Riding through never springs one.
//
// On the map (2026-09-15) the walk is a routed walk across the baked floor,
// as run2d does it, and "ahead" and "behind" are measured along the bore's
// arc, the old probe steered by station x and judged by station x, which on
// the map is neither along the tunnel nor anywhere near it, and it passed
// for as long as no tunnel answered at all.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asLeg, asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { corridorProject } from '../../src/core/corridor.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { routeTo } from '../../src/world/route2d.ts';
import * as C from '../../src/config.ts';

/** how many tunnels have answered: a leg remembers it itself now */
const sprungCount = (sim: Run): number => [...sim.places.values()].filter((pl) => asLeg(pl)?.cleared).length;

const faults: string[] = [];

function walk(seed: number, dir: 1 | -1): boolean | null {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const me = sim.me;
  const edges = new InputEdges();
  const home = asStation(sim.here);
  const c = home && corridorsToward(home, dir)[0];
  if (!home || !c) return null;
  const far = sim.ensurePlace(c.a === home.name ? c.b : c.a);
  const tag = `seed ${seed} ${home.name} -> ${far.name}`;
  const safe = () => {
    me.health = 999;
    me.alive = true;
    me.downed = false;
    me.iframesUntil = sim.gameNow + 60_000;
    me.noTrainHitUntil = sim.gameNow + 60_000;
  };
  safe();
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  const route = routeTo(sim, { x: me.x, y: me.y }, far, me.r);
  if (!route) {
    faults.push(`${tag}: no way across the map`);
    return null;
  }
  let springs = 0;
  let ahead = 0;
  let behind = 0;
  let nearest = Infinity;
  let k = 0;
  let lastS = 0;
  for (let t = 0; t < 12000; t++) {
    safe();
    while (k < route.length - 1 && Math.hypot(route[k].x - me.x, route[k].y - me.y) < C.M(1.5)) k += 1;
    const aim = route[k];
    const dx = aim.x - me.x;
    const dy = aim.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    const before = sprungCount(sim);
    sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
    const leg = asLeg(sim.placeOf(me));
    if (leg) {
      const s = corridorProject(leg.cor, me.x, me.y).s;
      if (sprungCount(sim) > before) {
        springs += 1;
        // the fresh mobs either side of the walker, ALONG THE BORE, "ahead"
        // being the way the walker is going
        const going = Math.sign(s - lastS) || 1;
        for (const e of leg.enemies) {
          if (e.hp <= 0 || !e.ofTunnel) continue;
          const es = corridorProject(leg.cor, e.x, e.y).s;
          const along = (es - s) * going;
          nearest = Math.min(nearest, Math.abs(along) / C.PX_PER_M);
          if (along > 0) ahead += 1;
          else behind += 1;
        }
      }
      lastS = s;
    }
    const on = sim.map.at(me.x, me.y);
    if (on && on.place === far && on.kind !== 'bore') break;
  }
  if (springs === 0) return false; // this leg was too short for one
  if (springs !== 1) faults.push(`${tag}: sprang ${springs} times`);
  if (ahead === 0 || behind === 0) faults.push(`${tag}: ${ahead} ahead / ${behind} behind`);
  // NOTHING APPEARS ON SCREEN. The view is about 40 m of tunnel wide, so a
  // spawn inside 45 m of the walker is a mob that popped into being in front
  // of them (from play 2026-09-06).
  if (nearest < 45) faults.push(`${tag}: something appeared ${nearest.toFixed(0)} m away`);
  return true;
}

let sprang = 0;
let walks = 0;
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const dir of [1, -1] as const) {
    const r = walk(seed, dir);
    if (r === null) continue;
    walks += 1;
    if (r) sprang += 1;
  }
}

// ...and riding never springs one
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();
goFlat(sim);
const me = sim.me;
const edges = new InputEdges();
for (let t = 0; t < 60 * 900 && sim.stopsTraveled < 8; t++) {
  for (const pl of sim.places.values()) pl.enemies.length = 0;
  me.health = 999;
  me.iframesUntil = sim.gameNow + 5000;
  if (me.frame.kind === 'world') {
    const st = asStation(sim.here);
    const ti = st
      ? st.rails.findIndex((r) => r.journey && r.train.phase === 'dwell' && r.train.doorsOpen)
      : -1;
    if (st && ti >= 0) {
      const rail = st.rails[ti];
      me.frame = { kind: 'aboard', ti, rx: rail.train.length / 2, ry: 0, jid: rail.journey! };
    }
  }
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
}
if (sprungCount(sim) > 0)
  faults.push(`riding ${sim.stopsTraveled} stops sprang ${sprungCount(sim)} ambush(es)`);

// nothing springing anywhere is the feature being gone, not sixteen legs
// all too short, a walk that never sprang is skipped above, so without
// this the probe passes on an ambush that no longer exists
if (sprang === 0) faults.push('no walk sprang an ambush at all');
console.log(`ambush: ${sprang}/${walks} walks sprang one, ${sim.stopsTraveled} stops ridden sprang none`);
for (const f of faults) console.log(`   ${f}`);
console.log(faults.length ? 'FAIL' : 'PASS');
process.exit(faults.length ? 1 : 0);
