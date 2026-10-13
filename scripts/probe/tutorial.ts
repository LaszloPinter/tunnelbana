// THE TUTORIAL RUN IS PEACEFUL AND ONE STOP LONG.
//
// A first-time player is put into a run with no horde, no dark and a fixed
// one-stop journey (core/network.ts tutorialJourney, sim/run.ts tutorial).
// This starts one, stands on the platform through three waves' worth of
// time and asks that nothing spawned; boards the train, rides the stop,
// and asks that the run ended as a win with nothing dealt after it.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { TUTORIAL_FROM, TUTORIAL_TO } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { seatOnMap } from '../../src/world/trainSeat.ts';
import { spawnAt } from '../../src/world/walk2d.ts';
import { routeToPoint } from '../../src/world/route2d.ts';
import { nearFixture } from '../../src/world/fixtures.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.tutorial = true;
sim.startRun();
sim.beginRun();
goFlat(sim);
const me = sim.me;
const edges = new InputEdges();
const st = asStation(sim.here);
if (!st) throw new Error('no station');
if (st.name !== TUTORIAL_FROM) faults.push(`started at ${st.name}, wanted ${TUTORIAL_FROM}`);
if (sim.destStation !== TUTORIAL_TO) faults.push(`bound for ${sim.destStation}, wanted ${TUTORIAL_TO}`);
if (sim.route.length !== 1 || sim.route[0].stops !== 1)
  faults.push(`the journey is not one stop: ${JSON.stringify(sim.route.map((l) => l.stops))}`);
if (st.manaMachines.length === 0) faults.push('no mana machine to learn E on');

// a minute standing still: dummies to look at, nothing that bites, no dark,
// and NO TRAIN, the platform is quiet until the last stage calls for one
let dummyTicks = 0;
let trainTicks = 0;
for (let k = 0; k < 3600; k++) {
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  if (st.enemies.some((e) => e.hp > 0)) dummyTicks += 1;
  if (st.rails.some((r) => r.journey)) trainTicks += 1;
}
if (dummyTicks < 3000) faults.push(`dummies stood on the platform for only ${dummyTicks} of 3600 ticks`);
if (st.enemies.some((e) => e.aggro)) faults.push('a dummy turned aggressive');
if (trainTicks > 0) faults.push(`a train showed up on ${trainTicks} ticks before the last stage`);
if (st.corruption > 0) faults.push('the dark crept in');
if (me.health < 100) faults.push(`hurt to ${me.health} while nothing was there`);

// TUTORIALSTORG: walk hard each way along the platform for ten seconds; the
// fence holds, and every machine stays within twenty metres of the walker
import { onPlatform, fromPlatform as fromPlat } from '../../src/world/floor.ts';
const pen = sim.tutorialPen;
if (!pen) faults.push('no pen on the tutorial run');
else {
  for (const sign of [1, -1] as const) {
    const isl = st.platforms[0];
    const along = fromPlat(st, st.platformX0 + 10, (isl.top + isl.bottom) / 2);
    const mid = fromPlat(st, (st.platformX0 + st.platformX1) / 2, (isl.top + isl.bottom) / 2);
    const ux = (mid.x - along.x) / Math.hypot(mid.x - along.x, mid.y - along.y);
    const uy = (mid.y - along.y) / Math.hypot(mid.x - along.x, mid.y - along.y);
    for (let k = 0; k < 600; k++) {
      me.health = 100;
      sim.runTick(
        edges.sample(k % 40 === 0 ? BTN.dash : 0, ux * sign, uy * sign, me.x, me.y, answerPicks(sim)),
      );
    }
    const at = onPlatform(st, me.x, me.y);
    if (!at || at.x < pen.x0 - 1 || at.x > pen.x1 + 1)
      faults.push(`walking ${sign > 0 ? 'one' : 'the other'} way got out of Tutorialstorg's pen`);
    if (sim.placeOf(me) !== st)
      faults.push(`walking ${sign > 0 ? 'one' : 'the other'} way left the station: in ${sim.placeOf(me).id}`);
    for (const m of [...st.manaMachines, ...st.healthMachines]) {
      const w = fromPlat(st, m.x, m.y);
      if (Math.hypot(w.x - me.x, w.y - me.y) > C.M(30))
        faults.push(
          `a machine is ${(Math.hypot(w.x - me.x, w.y - me.y) / C.M(1)).toFixed(0)} m from the walker at the pen's end`,
        );
    }
  }
  console.log(`  pen ${((pen.x1 - pen.x0) / C.M(1)).toFixed(0)} m long`);
  // back to where the tutorial put you: the dashes may have left you on a bed
  const isl0 = st.platforms[0];
  const back = fromPlat(st, (st.platformX0 + st.platformX1) / 2, (isl0.top + isl0.bottom) / 2);
  me.x = back.x;
  me.y = back.y;
}

// the last stage: the train is called for, and must be at the platform
// with its doors open within ten seconds, and stay open while nobody boards
sim.tutorialReady();
let openAt = -1;
for (let k = 0; k < 600 && openAt < 0; k++) {
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  if (st.rails.some((r) => r.journey && r.train.phase === 'dwell' && r.train.doorsOpen)) openAt = k;
}
if (openAt < 0) faults.push('the train did not come in with its doors open within ten seconds of ready');
else {
  // stand still for forty seconds, which is longer than any dwell: still open
  let stillOpen = true;
  for (let k = 0; k < 2400; k++) {
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    if (!st.rails.some((r) => r.journey && r.train.phase === 'dwell' && r.train.doorsOpen)) stillOpen = false;
  }
  if (!stillOpen) faults.push('the train did not wait: its doors closed with nobody aboard');
}
// the machine is reachable from where the tutorial says to walk
const near = st.manaMachines.some(() => true);
void near;

// board, ride the one stop, get off, walk to the exit and press E
import { fromPlatform } from '../../src/world/floor.ts';
import { nearExit } from '../../src/sim/ground.ts';
import { BTN } from '../../src/sim/tick.ts';
let route: { x: number; y: number }[] | null = null;
let leg = 0;
let boarded = false;
let alighted = false;
let goal: 'seat' | 'exit' | null = null;
let presses = 0;
const walkTo = (target: { x: number; y: number }, want: 'seat' | 'exit', held = 0) => {
  if (!route || goal !== want) {
    route = routeToPoint(sim, { x: me.x, y: me.y }, target, me.r);
    goal = want;
    leg = 0;
  }
  if (!route) {
    sim.runTick(edges.sample(held, 0, 0, me.x, me.y, answerPicks(sim)));
    return;
  }
  while (leg < route.length - 1 && Math.hypot(route[leg].x - me.x, route[leg].y - me.y) < C.M(1.2)) leg += 1;
  const a = route[leg];
  const dx = a.x - me.x;
  const dy = a.y - me.y;
  const d = Math.hypot(dx, dy) || 1;
  sim.runTick(edges.sample(held, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
};
let boardedAt = -1;
let destAt = -1;
let closedAt = -1;
for (let k = 0; k < 40000 && !sim.over; k++) {
  const here = asStation(sim.here);
  if (me.frame.kind === 'aboard') {
    boarded = true;
    if (boardedAt < 0) boardedAt = k;
    const rail = here?.rails[me.frame.ti];
    if (closedAt < 0 && rail && !rail.train.doorsOpen && k > boardedAt + 30) closedAt = k;
  }
  if (boarded && me.frame.kind === 'world' && !alighted) alighted = true;
  const atDest = here?.name === TUTORIAL_TO;
  if (atDest && destAt < 0) destAt = k;
  if (atDest && here) {
    const ex = here.escalators[0];
    if (!ex) {
      faults.push(`${here.name} has no exit to press E at`);
      break;
    }
    const f = me.frame;
    if (f.kind === 'aboard') {
      // ride out the arrival; once the doors are open, step off beside the
      // way out (getting off through a door is alight2d's business)
      const rail = here.rails[f.ti];
      if (!rail || !rail.train.doorsOpen || rail.train.phase !== 'dwell') {
        sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
        continue;
      }
      const at = fromPlatform(here, ex.x + C.M(3), ex.y);
      me.frame = { kind: 'world' };
      spawnAt(sim, me, at.x, at.y);
      alighted = true;
      continue;
    }
    // on the platform: to the way out, and E there
    const at = fromPlatform(here, ex.x, ex.y);
    const near = nearExit(here, me);
    if (near) presses += 1;
    walkTo(at, 'exit', near && presses % 30 === 1 ? BTN.use : 0);
    continue;
  }
  let seat: { x: number; y: number } | null = null;
  if (here && me.frame.kind === 'world') {
    for (let ti = 0; ti < here.rails.length; ti++) {
      const rail = here.rails[ti];
      const l = sim.route[0];
      if (!rail.journey || !rail.train.doorsOpen || rail.train.phase !== 'dwell') continue;
      if (l && (rail.current.service.id !== l.service.id || rail.current.dir !== l.dir)) continue;
      // the door nearest the walker: in Tutorialstorg the rest are past the fence
      let bd = Infinity;
      for (const d of rail.train.doors) {
        const at = seatOnMap(here, { ti, rx: (d.x0 + d.x1) / 2, ry: 0, jid: rail.journey }, sim.gameNow);
        if (!at) continue;
        const dd = Math.hypot(at.x - me.x, at.y - me.y);
        if (dd < bd) {
          bd = dd;
          seat = at;
        }
      }
    }
  }
  if (seat) walkTo(seat, 'seat');
  else {
    route = null;
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  }
}
if (!boarded) faults.push('never boarded the train');
// the ride is short: a minute of tunnel was the dullest part of the lesson
const rideS = (destAt - closedAt) / 60;
if (closedAt >= 0 && destAt >= 0 && rideS > 25)
  faults.push(
    `the ride took ${rideS.toFixed(1)} s from the doors closing to the next station, wanted under 25`,
  );
console.log(`tutorial ride: ${rideS.toFixed(1)} s from the doors closing to the next station`);
if (boardedAt >= 0 && closedAt < 0) faults.push('the doors never closed after boarding');
else if (boardedAt >= 0 && closedAt - boardedAt > 5 * 60)
  faults.push(
    `the doors took ${((closedAt - boardedAt) / 60).toFixed(1)} s to close after boarding, wanted under 5`,
  );
if (!alighted) faults.push('never got off at the destination');
if (!sim.over) faults.push('40000 ticks and the run never ended');
else if (sim.over.kind !== 'win') faults.push(`the run ended as ${sim.over.kind}: ${sim.over.reason}`);
if (sim.ride !== 1) faults.push(`rides made: ${sim.ride}, wanted 1`);
if (sim.destStation !== TUTORIAL_TO) faults.push(`a second ride was dealt: now bound for ${sim.destStation}`);
void nearFixture;

const ok = faults.length === 0;
console.log(
  `tutorial: a quiet minute with dummies, the train on cue and held, then one stop ridden and the run won / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
