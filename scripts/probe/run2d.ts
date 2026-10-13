// THE RUN ITSELF WALKS THE MAP.
//
// Not a hand-rolled loop over the geometry: the real simulation, ticking, with
// the world flat (run.flat2d). A body starts on a platform, walks off the end
// of it, down a tunnel that bends, and arrives at the next station, and the
// arrival is not an event anyone arranged. The ground under the walker simply
// belongs to a platform it did not belong to before.
//
// Everything this used to need, enterLeg, leaveLeg, the seam, the handover,
// the canned spot to be put down at, the sign per axis, is not here, because
// there is nothing to cross.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS, findRoute } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { showLevel } from '../../src/sim/stationBuild.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { routeTo } from '../../src/world/route2d.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let arrived = 0;
let worstTicks = 0;

// a sample of the network: the rule is about the map, not about which
// station you start from, and every run here is a full simulation
for (const name of ALL_STATIONS.slice(0, 24)) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.startRun();
  sim.beginRun();
  const me = sim.me;
  const edges = new InputEdges();

  const st = asStation(sim.ensurePlace(name));
  if (!st || st.rails.length === 0 || st.platforms.length === 0) continue;
  const c = corridorsToward(st, 1)[0] ?? corridorsToward(st, -1)[0];
  if (!c) continue;
  const a = asStation(sim.ensurePlace(c.a));
  const b = asStation(sim.ensurePlace(c.b));
  if (!a || !b || !a.platforms.length || !b.platforms.length) continue;
  showLevel(sim, a, c.la);
  showLevel(sim, b, c.lb);
  const leg = sim.ensureLeg(c);
  leg.cleared = true;
  const home = c.a === name ? a : b;
  const far = c.a === name ? b : a;
  sim.hereId = home.id;
  const isl = home.platforms[0];
  const start = fromPlatform(home, (home.platformX0 + home.platformX1) / 2, (isl.top + isl.bottom) / 2);
  spawnAt(sim, me, start.x, start.y);
  if (sim.map.at(me.x, me.y) === null) {
    faults.push(`${home.name}: the run cannot stand the walker on its own deck`);
    continue;
  }
  tried += 1;

  // walk toward a point a little further down the bore each tick, turning
  // with the tunnel, which is what walking a bend is
  // one tick first, so the run has worked out what is live and the map is
  // baked for more than the room the body is standing in (sim/places.ts)
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  // THE WALKER MEANS TO GO THERE: where two bores leave a station together the
  // ground is both, and the one a body is filed in is its route's (walk2d.ts
  // routeLegFrom), so the run's route says so, as a player's would
  sim.route = findRoute(home.name, far.name) ?? sim.route;
  // A ROUTE THROUGH THE MAP, then walk it. The world being connected is
  // `play2d`'s business; this is whether the running simulation can carry a
  // body along a way that exists. Steering by guesswork tests the guess.
  let route = routeTo(sim, { x: me.x, y: me.y }, far, me.r);
  if (!route) {
    faults.push(`${home.name} -> ${far.name}: no way across the map at all`);
    continue;
  }
  let k = 0;
  let done = false;
  let leg2 = 0;
  let advancedAt = 0;
  for (; k < 12000; k++) {
    me.health = 999;
    me.alive = true;
    me.downed = false;
    me.noTrainHitUntil = sim.gameNow + 60_000;
    me.iframesUntil = sim.gameNow + 60_000;
    // A CHASE THAT STALLS REPLANS. This follower walks straight at the next
    // point and calls it reached within 1.5 m, so at full pace it can cut a
    // corner at a platform's end and stand where the way on is a step down
    // onto the bed, which a walker may not take. A body that has not
    // gained a point in five seconds asks for a route from where it is now.
    if (k - advancedAt > 300) {
      const again = routeTo(sim, { x: me.x, y: me.y }, far, me.r);
      if (again) {
        route = again;
        leg2 = 0;
      }
      advancedAt = k;
    }
    while (leg2 < route.length - 1 && Math.hypot(route[leg2].x - me.x, route[leg2].y - me.y) < C.M(1.5)) {
      leg2 += 1;
      advancedAt = k;
    }
    const aim = route[leg2];
    const dx = aim.x - me.x;
    const dy = aim.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
    const on = sim.map.at(me.x, me.y);
    if (on && on.place.id === far.id && on.kind !== 'bore') {
      done = true;
      break;
    }
  }
  if (done) {
    arrived += 1;
    worstTicks = Math.max(worstTicks, k);
    if (sim.lastStationName !== far.name)
      faults.push(
        `${home.name} -> ${far.name}: arrived but the run still thinks it is at ${sim.lastStationName}`,
      );
  } else {
    const on = sim.map.at(me.x, me.y);
    faults.push(`${home.name} -> ${far.name}: stopped on ${on?.kind ?? 'nothing'} after ${k} ticks`);
  }
}

const ok = faults.length === 0;
console.log(
  `run2d: ${arrived}/${tried} runs walked from one station to the next across the map, worst ${worstTicks} ticks / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
