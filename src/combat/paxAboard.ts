import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { asStation } from '../sim/place.ts';
import { isOccupied } from '../sim/places.ts';
import { PAX_KINDS, type Passenger } from '../sim/passenger.ts';
import { waitSpot } from '../sim/paxSpawn.ts';
import type { Run } from '../sim/run.ts';
import type { Station } from '../sim/station.ts';
import { onPlatform } from '../world/floor.ts';
import { doorNormalOf, railTrainOf } from '../world/metal.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { clearSpot } from '../world/walk2d.ts';
import { strike } from './paxFight.ts';
import { enemyJid } from './enemyTarget.ts';

/**
 * PASSENGERS ON A TRAIN (DESIGN §20): to their seat, carried, fighting what
 * is in the car with them at a platform, and off, on foot, through the
 * doorway on the platform side, at the station they were riding to.
 */
const GONE_AT = C.M(80);

/**
 * ABOARD: walking to their seat, carried with the train, fighting what is
 * in the car with them while it stands at a platform, and off, together,
 * at the station they were riding to. A train that has left where they
 * are and is out of the party's sight takes them out of the world.
 */
export function stepAboardPax(run: Run, ps: Passenger, dt: number, now: number) {
  const f = ps.frame;
  if (f.kind !== 'aboard' || !ps.jid || !railTrainOf(run, ps.jid)) {
    ps.alive = false;
    return;
  }
  // getting off: down the car to a door, and out through it
  if (ps.alighting) {
    walkOut(run, ps, dt, now);
    return;
  }
  // to the seat, at an easy walk, inside the car
  const step = C.PLAYER_SPEED * 0.45 * dt;
  const dx = ps.seatRx - f.rx;
  const dy = ps.seatRy - f.ry;
  const d = dist(dx, dy);
  if (d > 1) {
    f.rx += (dx / d) * Math.min(step, d);
    f.ry += (dy / d) * Math.min(step, d);
  }
  const at = aboardPoint(ps.jid, f.rx, f.ry, now);
  if (!at) {
    ps.alive = false;
    return;
  }
  ps.x = at.x;
  ps.y = at.y;
  // standing at a platform where the party is?
  const here = stationOfTrain(run, ps.jid);
  if (here) {
    const { st, rail } = here;
    if (isOccupied(run, st)) fightInTheCar(run, st, ps, now);
    if (rail.train.phase === 'dwell' && rail.train.doorsOpen && st.id !== ps.lastStop) {
      ps.lastStop = st.id;
      ps.placeId = st.id;
      ps.stopsToGo -= 1;
      if (ps.stopsToGo <= 0 && isOccupied(run, st)) ps.alighting = true;
    }
    return;
  }
  const st = asStation(run.places.get(ps.placeId));
  const left = !st || !st.rails.some((r) => r.journey === ps.jid);
  if (left && !run.players.some((p) => p.alive && dist(p.x - ps.x, p.y - ps.y) < GONE_AT)) ps.alive = false;
}

/** the live station whose platform this train is standing at, if any */
function stationOfTrain(run: Run, jid: string) {
  for (const id of run.live) {
    const st = asStation(run.places.get(id));
    const rail = st?.rails.find(
      (r) => r.journey === jid && (r.train.phase === 'dwell' || r.train.phase === 'arriving'),
    );
    if (st && rail) return { st, rail };
  }
  return null;
}

/**
 * WHICH SIDE OF THE CAR THE PLATFORM IS ON, here, asked of the ground: a
 * step out either side, and whichever lands on this station's deck, the
 * doorway a passenger uses to get on and off. The train's own door-side
 * memory is the fallback.
 */
export function platformSide(run: Run, st: Station, jid: string, rx: number, now: number): 1 | -1 {
  for (const d of [2.2, 2.8, 3.5, 4.5]) {
    for (const side of [1, -1] as const) {
      const p = aboardPoint(jid, rx, side * C.M(d), now);
      if (p && run.map.at(p.x, p.y, st.id)?.kind === 'platform') return side;
    }
  }
  return doorNormalOf(run, jid, now);
}

/**
 * GETTING OFF, ON FOOT: along the car to the nearest door, then across to the
 * doorway on the platform side, and one step out, never a hop from the seat
 * to the platform (from play 2026-10-11: "they kind of teleport out"). If the
 * doors shut first they sit back down and get off at the next stop.
 */
function walkOut(run: Run, ps: Passenger, dt: number, now: number) {
  const f = ps.frame;
  const t = ps.jid ? railTrainOf(run, ps.jid) : null;
  const here = ps.jid ? stationOfTrain(run, ps.jid) : null;
  if (f.kind !== 'aboard' || !ps.jid || !t || !here || here.rail.train.phase !== 'dwell' || !t.doorsOpen) {
    // the doors shut: back to the seat; off at the next stop
    ps.alighting = false;
    ps.stopsToGo = 1;
    return;
  }
  const out = platformSide(run, here.st, ps.jid, f.rx, now);
  let doorX = f.rx;
  let bd = Infinity;
  for (const d of t.doors) {
    const c = (d.x0 + d.x1) / 2;
    if (Math.abs(c - f.rx) < bd) {
      bd = Math.abs(c - f.rx);
      doorX = c;
    }
  }
  const step = C.PLAYER_SPEED * 0.6 * dt;
  if (Math.abs(doorX - f.rx) > C.M(0.3))
    f.rx += Math.sign(doorX - f.rx) * Math.min(step, Math.abs(doorX - f.rx));
  else f.ry += out * step;
  const at = aboardPoint(ps.jid, f.rx, f.ry, now);
  if (at) {
    ps.x = at.x;
    ps.y = at.y;
  }
  if (f.ry * out < C.CAR_WIDTH / 2) return;
  // through the doorway: one step out, onto the platform
  const off = aboardPoint(ps.jid, f.rx, out * (C.CAR_WIDTH / 2 + ps.r + C.M(0.5)), now);
  if (!off) return;
  const spot = clearSpot(run, off.x, off.y, C.M(0.55), 'platform');
  const st = here.st;
  ps.alighting = false;
  ps.mode = 'foot';
  ps.frame = { kind: 'world' };
  ps.placeId = st.id;
  ps.x = spot.x;
  ps.y = spot.y;
  ps.since = now;
  // a changer goes to wait by their track; everyone else leaves
  if (ps.plan === 'catch' && ps.waitTi >= 0 && st.rails[ps.waitTi]?.journey !== ps.jid) {
    const l = onPlatform(st, ps.x, ps.y);
    const w = l
      ? waitSpot(run, st, ps.waitTi, (l.x - st.platformX0) / (st.platformX1 - st.platformX0 || 1))
      : null;
    if (w) {
      ps.homeX = ps.anchorX = w.x;
      ps.homeY = ps.anchorY = w.y;
    }
  } else ps.plan = 'exit';
  ps.jid = null;
}

/** what is in the car with them, while the train stands at a platform */
function fightInTheCar(run: Run, st: Station, ps: Passenger, now: number) {
  const k = PAX_KINDS[ps.kind];
  if (k.role === 'healer' || now < ps.cdUntil) return;
  const ctx = run.hostFor(st);
  for (const e of st.enemies) {
    if (e.hp <= 0 || enemyJid(st, e) !== ps.jid) continue;
    if (dist(e.x - ps.x, e.y - ps.y) > ps.r + e.r + C.M(0.8)) continue;
    strike(ctx, ps, e, now);
    return;
  }
}
