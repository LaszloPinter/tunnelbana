// YOU CAN GET ON A TRAIN, AND IT TAKES YOU WITH IT.
//
// The run's whole loop: stand on a platform, step through an open door, and
// be carried down the tunnel. On the map that needs no gap-crossing rule and
// no handover, a body walks, and at some point it is inside the metal.
//
// A seat is kept RELATIVE to the car, which is how riding has always been
// expressed; the only line that ever needed a station was the one turning
// that seat into a place in the world, and it asks the LINE now. So the seat
// means the same thing at a platform, in a tunnel, and at the moment of
// crossing between them, which is exactly where a train used to jump.
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
let boarded = 0;
let carried = 0;

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

  // RIDING, not fighting. A platform full of vattar shoves a body about, and
  // this is about whether a train can be got onto and whether it carries you.
  const safe = () => {
    me.health = 999;
    me.alive = true;
    me.downed = false;
    me.iframesUntil = sim.gameNow + 600_000;
    for (const pl of sim.places.values()) pl.enemies.length = 0;
  };

  // wait for a train to stand with its doors open, then step to the seat by
  // the door and walk into it
  let on = false;
  let route: { x: number; y: number }[] | null = null;
  let leg = 0;
  for (let k = 0; k < 6000 && !on; k++) {
    safe();
    // a train standing with its doors open, and a way across the map to it.
    // Steering at it by eye tests the steering; this is about boarding.
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
    if (me.frame.kind === 'aboard') on = true;
  }
  if (!on) {
    faults.push(`${name}: never got aboard a train standing with its doors open`);
    continue;
  }
  boarded += 1;

  // ...and it takes you with it: still inside the metal a good way later
  let outside = 0;
  let moved = 0;
  const from = { x: me.x, y: me.y };
  for (let k = 0; k < 5000; k++) {
    safe();
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    if (me.frame.kind !== 'aboard') break;
    const jid = me.frame.jid ?? st.rails[me.frame.ti]?.journey;
    const body = jid ? trainBody(jid, sim.gameNow) : null;
    if (body && !inBody(body, me.x, me.y, -C.M(0.2))) {
      outside += 1;
      if (outside === 1)
        console.log(
          `   first outside at k=${k}: jid=${jid ?? 'none'} seat=${me.frame.kind === 'aboard' ? `${me.frame.rx.toFixed(0)},${me.frame.ry.toFixed(0)}` : '-'} phase=${st.rails[me.frame.kind === 'aboard' ? me.frame.ti : 0]?.train.phase}`,
        );
    }
    moved = Math.max(moved, Math.hypot(me.x - from.x, me.y - from.y));
  }
  if (outside > 0) faults.push(`${name}: ${outside} ticks riding OUTSIDE the train's own body`);
  else if (moved < C.M(30)) faults.push(`${name}: aboard, but the train never carried them anywhere`);
  else carried += 1;
}

const ok = faults.length === 0;
console.log(
  `ride2d: ${boarded}/${tried} boarded through an open door, ${carried} carried away inside the metal / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 6)) console.log(`  ${f}`);
if (!ok) console.log(`  ...${faults.length} in all`);
process.exit(ok ? 0 : 1);
