// THE DOORS SHUT ON YOU, AND YOU LIVE.
//
// From play 2026-09-24: "boarded a train and died as soon as it started to
// move". Half in the doorway when the doors closed, a body stood in a flank
// that had just become solid, and the first metre of motion "crushed" it.
// This walks into a doorway and STOPS there, inside the body, but not deep
// enough to have boarded, waits for the doors to close and the train to
// pull out, and asks that the body is alive and either riding or standing
// on the platform.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { inBody, trainBody } from '../../src/world/trains2d.ts';
import { seatOnMap } from '../../src/world/trainSeat.ts';
import { routeToPoint } from '../../src/world/route2d.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let stood = 0;
let rode = 0;
let stayed = 0;

for (const name of ALL_STATIONS.slice(0, 8)) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.station = name;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const me = sim.me;
  const edges = new InputEdges();
  const st = asStation(sim.here);
  if (!st || st.rails.length === 0) continue;
  tried += 1;
  const clearAll = () => {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
  };
  let route: { x: number; y: number }[] | null = null;
  let leg = 0;
  let doorJid: string | null = null;
  for (let k = 0; k < 6000 && !doorJid; k++) {
    clearAll();
    me.health = 100;
    let seat: { x: number; y: number } | null = null;
    for (let ti = 0; ti < st.rails.length; ti++) {
      const rail = st.rails[ti];
      if (!rail.journey || !rail.train.doorsOpen || rail.train.phase !== 'dwell') continue;
      seat = seatOnMap(st, { ti, rx: rail.train.length / 2, ry: 0, jid: rail.journey }, sim.gameNow);
    }
    if (!seat) {
      route = null;
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      continue;
    }
    if (!route) {
      route = routeToPoint(sim, { x: me.x, y: me.y }, seat, me.r);
      leg = 0;
    }
    if (!route) {
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      continue;
    }
    while (leg < route.length - 1 && Math.hypot(route[leg].x - me.x, route[leg].y - me.y) < C.M(1.2))
      leg += 1;
    const aim = route[leg];
    const dx = aim.x - me.x;
    const dy = aim.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
    if (me.frame.kind === 'aboard') break;
    // in the doorway: inside the body, not yet by the half radius that boards
    for (let ti = 0; ti < st.rails.length; ti++) {
      const jid = st.rails[ti].journey;
      if (!jid) continue;
      const b = trainBody(jid, sim.gameNow);
      if (b && inBody(b, me.x, me.y, 0) && !inBody(b, me.x, me.y, -me.r * 0.5)) doorJid = jid;
    }
  }
  if (!doorJid) {
    if (me.frame.kind === 'aboard')
      stayed += 0; // boarded straight through: nothing to test here
    else faults.push(`${name}: never reached a doorway`);
    continue;
  }
  stood += 1;
  // stand still through the closing and the departure
  let gone = false;
  for (let k = 0; k < 3000 && !gone; k++) {
    clearAll();
    me.health = 100;
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    if (!me.alive) {
      faults.push(`${name}: died standing in the doorway (frame ${me.frame.kind})`);
      break;
    }
    const b = trainBody(doorJid, sim.gameNow);
    if (!b) break;
    if (Math.abs(b.speed) > C.M(5)) gone = true;
  }
  if (!me.alive) continue;
  if (!gone) {
    faults.push(`${name}: the train never pulled out`);
    continue;
  }
  if (me.frame.kind === 'aboard') rode += 1;
  else {
    const on = sim.map.at(me.x, me.y);
    if (on?.kind === 'platform') stayed += 1;
    else faults.push(`${name}: left standing on ${on?.kind ?? 'nothing'} after the train left`);
  }
}

const ok = faults.length === 0;
console.log(
  `doorway: ${stood}/${tried} stood in a closing doorway. ${rode} carried aboard, ${stayed} put back on the platform, nobody crushed / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
