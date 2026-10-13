// HITTING WHAT RIDES WITH YOU.
//
// From play 2026-09-21: "Hitting enemies while we are both on the train is
// very difficult. The hit doesn't register." A bolt cast aboard leaves the
// muzzle with the car's speed under it (combat/casting.ts trainDrift), so a
// shot down a moving aisle should land like one on a platform. This boards
// a train, waits until it is running through the tunnel, puts a vätte in the
// same car four metres ahead and four metres behind, fires at each for two
// seconds, and counts the blood.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges, BTN } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { trainBody } from '../../src/world/trains2d.ts';
import { seatDrift, seatOnMap } from '../../src/world/trainSeat.ts';
import { routeToPoint } from '../../src/world/route2d.ts';
import { spawnEnemy } from '../../src/combat/enemies.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let fought = 0;

for (const name of ALL_STATIONS.slice(0, 6)) {
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
  const safe = () => {
    me.health = 999;
    me.mana = 999;
    me.alive = true;
    me.downed = false;
    me.iframesUntil = sim.gameNow + 600_000;
  };
  const clearAll = () => {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
  };
  let on = false;
  let route: { x: number; y: number }[] | null = null;
  let leg = 0;
  for (let k = 0; k < 6000 && !on; k++) {
    safe();
    clearAll();
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
    faults.push(`${name}: never got aboard`);
    continue;
  }
  // wait for the train to be running through the tunnel
  let running = false;
  for (let k = 0; k < 4000 && !running; k++) {
    safe();
    clearAll();
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    if (me.frame.kind !== 'aboard') break;
    const jid = me.frame.jid;
    const body = jid ? trainBody(jid, sim.gameNow) : null;
    if (body && Math.abs(body.speed) > C.M(20)) running = true;
  }
  if (!running || me.frame.kind !== 'aboard') {
    faults.push(`${name}: the train never got up to speed in a tunnel with the rider aboard`);
    continue;
  }
  fought += 1;
  const f = me.frame;
  const host = sim.hostFor(sim.placeOf(me));
  for (const ahead of [1, -1] as const) {
    clearAll();
    const e = spawnEnemy(
      host,
      'runner',
      { kind: 'aboard', ti: f.ti, rx: f.rx + ahead * C.M(4), ry: f.ry, jid: f.jid },
      0,
      0,
      false,
    );
    e.hp = e.maxHp = 9999;
    const hp0 = e.hp;
    let sawProj = 0;
    let sameCar = 0;
    for (let k = 0; k < 120; k++) {
      safe();
      e.speedMul = 0;
      e.aggro = false;
      e.hitCdUntil = sim.gameNow + 60_000;
      const hereE =
        sim.placeOf(me) === (sim.places.get(e.frame.kind === 'aboard' ? '' : '') ?? sim.placeOf(me));
      void hereE;
      sim.runTick(edges.sample(BTN.fire, 0, 0, e.x, e.y, answerPicks(sim)));
      for (const pl of sim.places.values()) if (pl.projs.length > 0) sawProj += 1;
      if (Math.hypot(e.x - me.x, e.y - me.y) < C.M(6)) sameCar += 1;
    }
    const hits = hp0 - e.hp;
    if (hits <= 0) {
      const where = [...sim.places.values()].find((pl) => pl.enemies.includes(e))?.id ?? 'nowhere';
      faults.push(
        `${name}: two seconds of bolts at a vätte ${ahead > 0 ? 'ahead' : 'behind'} in the same car drew no blood (projectile ticks ${sawProj}, near ${sameCar}/120, vätte filed in ${where}, rider in ${sim.placeOf(me).id})`,
      );
    }
  }
  // ...and the other way round: a spitter in the same car, ahead and behind,
  // has to land its spit on a rider at speed (from play 2026-09-24: "spitters
  // cannot hit me while we are on the train, and their shots fly extra fast
  // toward the back", the glob had neither the car's drift nor its jid).
  for (const ahead of [1, -1] as const) {
    if (me.frame.kind !== 'aboard') break;
    clearAll();
    const f2 = me.frame;
    const e = spawnEnemy(
      sim.hostFor(sim.placeOf(me)),
      'spitter',
      { kind: 'aboard', ti: f2.ti, rx: f2.rx + ahead * C.M(4), ry: f2.ry, jid: f2.jid },
      0,
      0,
      true,
    );
    e.hp = e.maxHp = 9999;
    let hits = 0;
    let fastest = 0;
    for (let k = 0; k < 240; k++) {
      me.health = 999;
      me.mana = 999;
      me.alive = true;
      me.downed = false;
      me.iframesUntil = 0;
      e.speedMul = 0;
      e.hitCdUntil = sim.gameNow + 60_000;
      const drift = f2.jid ? seatDrift(f2.jid, f2.rx, sim.gameNow) : null;
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      if (me.health < 999) hits += 1;
      // a glob's speed RELATIVE TO THE CAR must be its own, not its own plus the train's
      for (const pl of sim.places.values())
        for (const pr of pl.projs) {
          if (pr.friendly || !drift) continue;
          const rel = Math.hypot(pr.vx - drift.vx, pr.vy - drift.vy);
          if (rel > fastest) fastest = rel;
        }
    }
    if (hits === 0) {
      faults.push(
        `${name}: four seconds of a spitter ${ahead > 0 ? 'ahead' : 'behind'} in the same car never hit the rider`,
      );
    }
    if (fastest > C.M(9) * 1.2) {
      faults.push(
        `${name}: a spit ${ahead > 0 ? 'ahead' : 'behind'} flew at ${(fastest / C.M(1)).toFixed(1)} m/s relative to the car (glob speed is 9)`,
      );
    }
  }
}

const ok = faults.length === 0;
console.log(
  `aboardfight: ${fought}/${tried} rides fought in the tunnel, bolts landed ahead and behind, spit landed too / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 8)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
