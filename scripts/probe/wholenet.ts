// THE WHOLE NETWORK IN ONE GO: after startRun, is every station alive, on the
// map, and joined to its neighbours by legs both ends agree about?
//
//   node --experimental-strip-types scripts/probe/wholenet.ts
//
// This is the acceptance check for wiring the game onto src/core/networkMap:
// 100 places built at run start, each with its map frame, every leg a real
// span whose two ends meet at the same world point, plus what it costs,
// because "build everything, optimise later" is only honest if the cost of
// everything is measured.

import * as C from '../../src/config.ts';
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { asStation } from '../../src/sim/place.ts';
import { putInLegAt } from '../lib/legs.ts';
import { fromPlatform } from '../../src/world/floor.ts';
import { Station } from '../../src/sim/station.ts';
import { ALL_STATIONS, departuresFrom } from '../../src/core/network.ts';
import { corridorOf, corridorPos, corridorProject } from '../../src/core/corridor.ts';
import { corridorToward } from '../../src/sim/places.ts';
import { EMPTY_INPUT, InputEdges } from '../../src/sim/tick.ts';
import { journeyById } from '../../src/core/fleet.ts';

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};
/** the graph holds legs as well as stations now (sim/place.ts) */
const stationsUp = () => [...sim.places.values()].filter((p) => p.kind === 'station').length;

// ---- 1. build it, and what that costs ----
const mem0 = process.memoryUsage().heapUsed;
const t0 = performance.now();
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
sim.beginRun();
const t1 = performance.now();
const mem1 = process.memoryUsage().heapUsed;
console.log(
  `startRun with the whole network: ${(t1 - t0).toFixed(0)} ms, ` +
    `~${((mem1 - mem0) / 1e6).toFixed(0)} MB heap`,
);

// ---- 2. is everything alive? ----
console.log(`places live: ${sim.places.size} (${stationsUp()} stations)`);
// the graph holds legs as well as stations now (sim/place.ts), so count the
// platforms among them
const stationCount = [...sim.places.values()].filter((p) => p.kind === 'station').length;
if (stationCount !== ALL_STATIONS.length)
  fail(`expected ${ALL_STATIONS.length} live stations, got ${stationCount}`);
for (const name of ALL_STATIONS) {
  const st = asStation(sim.places.get(Station.idOf(name)));
  if (!st) {
    fail(`${name} is not live`);
    continue;
  }
  if (st.platforms.length === 0) fail(`${name} has no platforms laid out`);
  if (!Number.isFinite(st.mapX) || !Number.isFinite(st.mapY)) fail(`${name} has no map position`);
  if (st.mapHalfLen <= 0) fail(`${name} has no platform span on the map`);
}
if (!failed) console.log('  ok   every station is built, laid out, and knows where it is');

// ---- 3. every leg is a real corridor in the one world ----
let legs = 0;
let covered = 0;
let openAir = 0;
let shortest = Infinity;
let shortestPair = '';
const seenPair = new Set<string>();
for (const name of ALL_STATIONS) {
  for (const d of departuresFrom(name)) {
    const key = name < d.next ? `${name}|${d.next}` : `${d.next}|${name}`;
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    const c = corridorOf(name, d.next);
    legs += 1;
    if (!c) {
      fail(`${name} <-> ${d.next}: no corridor`);
      continue;
    }
    const span = c.s1 - c.s0;
    if (!(span > C.M(40)))
      fail(`${name} <-> ${d.next}: walkable span only ${(span / C.PX_PER_M).toFixed(0)} m`);
    if (span < shortest) {
      shortest = span;
      shortestPair = `${name} <-> ${d.next}`;
    }
    if (c.cover < 0.55) openAir += 1;
    else covered += 1;
  }
}
console.log(
  `corridors: ${legs}: ${covered} bored (with recesses), ${openAir} open-air (bridges with walkways); ` +
    `shortest ${(shortest / C.PX_PER_M).toFixed(0)} m (${shortestPair})`,
);

// ---- 4. the run still runs on top of it ----
for (let t = 0; t < 60 * 5; t++) sim.runTick(EMPTY_INPUT);
const stillUp = stationsUp();
if (stillUp !== ALL_STATIONS.length)
  fail(`after 5 s of ticks only ${stillUp} stations are live. Something evicted the network`);
else console.log('  ok   5 s of ticks with the whole network up: nothing evicted');

// ---- 5. walking the leg is a corridor crossing, and the old floor stays ----
const start = sim.hereStation!;
const walk_c = corridorToward(sim.hereStation!, 1) ?? corridorToward(sim.hereStation!, -1)!;
const startAtA = walk_c.a === start.name;
const expectName = startAtA ? walk_c.b : walk_c.a;
const floorIdsBefore = start.enemies.filter((e) => e.frame.kind === 'world').map((e) => e.id);
const me = sim.me;
me.frame = { kind: 'world' };
putInLegAt(sim, me, walk_c, startAtA ? walk_c.s1 - C.M(30) : walk_c.s0 + C.M(30), 0);
// the far mouth is s1 when we came in at a; on the map the stick is a world
// direction, so walk along the bore's tangent where the walker is
const walkSign: 1 | -1 = startAtA ? 1 : -1;
const edges = new InputEdges();
for (let t = 0; t < 60 * 30 && !sim.hereStation; t++) {
  me.health = 999;
  me.iframesUntil = sim.gameNow + 5000;
  me.noTrainHitUntil = sim.gameNow + 5000;
  const q = corridorPos(walk_c, corridorProject(walk_c, me.x, me.y).s);
  sim.runTick(edges.sample(0, walkSign * q.tx, walkSign * q.ty, 0, 0, 0));
}
if (!sim.hereStation) fail('walked a whole leg and never arrived anywhere');
else {
  console.log(`walked the tunnel: ${start.name} -> ${sim.hereStation!.name} (expected ${expectName})`);
  if (sim.hereStation!.name !== expectName) fail(`arrived at ${sim.hereStation!.name}, not ${expectName}`);
  if (sim.me.placeId !== sim.hereStation!.id) fail('the walker is not standing in the place they arrived at');
  const old = sim.places.get(start.id);
  if (old !== start) fail('the place walked away from was rebuilt or replaced. It should just persist');
  else {
    // NOTHING IS CULLED BY A PLACE CHANGE. On the map a mob leaves a room
    // the honest way, by walking out of it (the ground under it changes
    // hands, world/metal.ts reroom), or it dies, on the tracks of the bore
    // it followed you into, as often as not. What must hold is that every
    // mob that exists stands on the floor of the room that holds it.
    const here = new Set(start.enemies.map((e) => e.id));
    const lost = floorIdsBefore.filter((id) => !here.has(id));
    let misfiled = 0;
    let standing = 0;
    for (const pl of sim.places.values())
      for (const e of pl.enemies) {
        if (e.hp <= 0 || e.frame.kind !== 'world') continue;
        standing += 1;
        if (sim.map.at(e.x, e.y, pl.id)?.place.id !== pl.id) misfiled += 1;
      }
    if (misfiled > 0) fail(`${misfiled} of ${standing} mobs stand on ground that belongs to another room`);
    else
      console.log(
        `  ok   the old place persists; ${floorIdsBefore.length} were on its floor, ${lost.length} left it, all ${standing} standing mobs are filed where they stand`,
      );
  }
  if (stationsUp() !== ALL_STATIONS.length) fail(`after the walk only ${stationsUp()} stations are live`);
}

// ---- 6. riding is a place change WITH the train: no wrap, no rebuild ----
const origin = sim.hereStation!;
// the walk left the party on the arrival bed; climb onto the platform like a
// live player would, or the next arriving train settles the question, said
// on the map, where the platform's own along-and-across is nowhere
const deck = fromPlatform(
  origin,
  (origin.platformX0 + origin.platformX1) / 2,
  (origin.platforms[0].top + origin.platforms[0].bottom) / 2,
);
me.x = deck.x;
me.y = deck.y;
let boardedJourney = '';
let seatRx = 0;
let rode = false;
for (let t = 0; t < 60 * 400 && !rode; t++) {
  if (sim.over) break;
  me.health = 999;
  me.iframesUntil = sim.gameNow + 5000;
  sim.hereStation!.enemies.length = 0;
  const fr = sim.me.frame;
  if (fr.kind === 'world') {
    const ti = sim.hereStation!.rails.findIndex(
      (r) => r.train.phase === 'dwell' && r.train.doorsOpen && sim.gameNow < r.train.departAt - 2000,
    );
    if (ti >= 0) {
      const rail = sim.hereStation!.rails[ti];
      const tr = rail.train;
      // into the middle of the FIRST CAR BODY, never the middle of the
      // train: a short train's midpoint is its coupling gap, and that is a
      // joint ride, not a seat. A seat is relative to the car, on the map as
      // anywhere (world/trainSeat.ts)
      boardedJourney = rail.journey ?? '';
      me.frame = {
        kind: 'aboard',
        ti,
        rx: (tr.bodies[0].x0 + tr.bodies[0].x1) / 2,
        ry: 0,
        jid: boardedJourney,
      };
    }
  } else if (fr.kind === 'aboard' && sim.hereStation! === origin) {
    seatRx = fr.rx;
  }
  sim.runTick(edges.sample(0, 0, 0, Math.round(me.x + 100), Math.round(me.y), 0));
  if (sim.hereStation! !== origin) rode = true;
}
if (sim.over) fail(`the run ended before riding: ${sim.over.kind}: ${sim.over.reason}`);
else if (!rode) fail('waited 400 s and never rode anywhere');
else {
  const j = journeyById(boardedJourney);
  const stopIdx = j ? j.stops.findIndex((s) => s.station === origin.name) : -1;
  const schedNext = j && stopIdx >= 0 ? j.stops[stopIdx + 1]?.station : undefined;
  console.log(
    `rode ${boardedJourney}: ${origin.name} -> ${sim.hereStation!.name} (schedule says ${schedNext})`,
  );
  if (sim.hereStation!.name !== schedNext)
    fail(`the ride arrived at ${sim.hereStation!.name}, not ${schedNext}`);
  if (me.placeId !== sim.hereStation!.id)
    fail('the rider is not standing in the place the train pulled into');
  const fr = sim.me.frame;
  if (fr.kind === 'world') fail('the rider fell out of the train across the handover');
  else {
    if (Math.abs(fr.rx - seatRx) > 0.01)
      fail(`the rider slid ${(fr.rx - seatRx).toFixed(1)} px along the car across the handover`);
    const destRail = sim.hereStation!.rails[fr.ti];
    if (destRail?.journey !== boardedJourney)
      fail(
        `the rider's track at ${sim.hereStation!.name} runs ${destRail?.journey}, not the ridden ${boardedJourney}`,
      );
    else
      console.log(
        `  ok   still aboard ${boardedJourney}, same seat, now realised at ${sim.hereStation!.name}`,
      );
  }
  if (sim.places.get(origin.id) !== origin) fail('the place ridden away from was rebuilt or replaced');
  if (origin.rails.some((r) => r.journey === boardedJourney && r.train.active()))
    fail('the origin still holds the ridden train in transit. It should have left with its journey');
  if (stationsUp() !== ALL_STATIONS.length) fail(`after the ride only ${stationsUp()} stations live`);
}

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);
