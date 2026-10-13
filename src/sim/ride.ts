import * as C from '../config.ts';
import { clamp } from './det.ts';
import { airborne, type Player } from './player.ts';
import type { Run } from './run.ts';
import type { Place } from './place.ts';
import { seatHeading, seatOnMap } from '../world/trainSeat.ts';
import { doorNormalOf } from '../world/metal.ts';

/**
 * RIDING A CAR.
 *
 * A seat is kept RELATIVE to the train, so far along it from one end, so far
 * across it, and everything about riding works in those terms: the seats you
 * cannot walk through, the doors you can, the joints between units. That was
 * always the right way round, and it is why riding survived the world being
 * rebuilt underneath it.
 *
 * Only two things ever needed the world outside: where that seat IS
 * (src/world/trains2d.ts), and which way a push on the stick means, since
 * inside a car forward is along the body and on the map the body lies at
 * whatever angle the line does.
 */

/**
 * WHICH WAY IS OUT, from a seat.
 *
 * A station's plan says the doors face +y IN THAT ROOM. A seat on the map is
 * measured across the train's own travel, and at half the network's stops a
 * service runs against the room's axis, so the two are opposite, and "toward
 * the platform" pushed the rider into the far wall instead. Half of every
 * journey ended with a passenger who could not get off (from play
 * 2026-09-11: "I cannot get off the train even when the doors are open").
 */
function wayOut(run: Run, st: Place, ti: number, jid: string | undefined, now: number): 1 | -1 {
  const t = st.rails[ti].train;
  const id = jid ?? st.rails[ti].journey;
  return id ? doorNormalOf(run, id, now) : t.doorSide;
}

export function stepAboard(run: Run, st: Place, p: Player, mx: number, my: number, now: number) {
  const f = p.frame;
  if (f.kind !== 'aboard') return;
  // A RIDER IS ON A TRAIN, NOT IN A SLOT (enemyAboard.ts learned this first):
  // a rail is a slot that the fleet hands to whatever calls next, so a rider
  // still naming the old slot would be carried off by a stranger's train.
  // Find the slot this journey is actually in; if it is in none, the train
  // is gone from here and the rider is put down where they are.
  if (f.jid && st.rails[f.ti]?.journey !== f.jid) {
    const ti = st.rails.findIndex((r) => r.journey === f.jid);
    if (ti >= 0) f.ti = ti;
    else {
      console.warn(`[tunnelbana] rider's train ${f.jid} has no rail at ${st.name}; put down`);
      const off = seatOnMap(st, f, now);
      p.frame = { kind: 'world' };
      if (off) {
        p.x = off.x;
        p.y = off.y;
      }
      run.showMsg('The train is gone from under you.', now, p);
      return;
    }
  }
  const t = st.rails[f.ti].train;
  const out = wayOut(run, st, f.ti, f.jid, now);
  const r = p.r;
  const air = airborne(p, now);
  const wallY = C.CAR_WIDTH / 2 - r - 1;
  // INSIDE A CAR, forward is along the body and sideways across it, and on
  // the map the body lies at whatever angle the line does, so a push on the
  // stick must be said in the car's terms first.
  const head = f.jid ? seatHeading(f.jid, f.rx, now) : null;
  if (head) {
    const along = mx * head.tx + my * head.ty;
    my = -mx * head.ty + my * head.tx;
    mx = along;
  }
  let rx = f.rx + mx;
  const body = t.bodyAtRel(rx);
  rx = clamp(rx, body.x0 + r + 2, body.x1 - r - 2);
  if (!air && t.seatBlocked(rx, f.ry, r)) rx = f.rx; // seats block, jump over them
  // u > 0 is toward the platform, whichever side that physically is
  let u = (f.ry + my) * out;
  u = Math.max(u, -wallY);
  if (u > wallY) {
    if (t.passableAtRel(rx, r)) {
      if (u >= C.CAR_WIDTH / 2) {
        const off = seatOnMap(st, { ...f, rx, ry: u * out }, now);
        p.frame = { kind: 'world' };
        p.x = off ? off.x : t.x + rx;
        p.y = off ? off.y : t.centerY + u * out;
        return;
      }
    } else {
      u = wallY; // door leaves push you back inside
    }
  }
  let ry = u * out;
  if (!air && t.seatBlocked(rx, ry, r)) ry = f.ry;
  f.rx = rx;
  f.ry = ry;
  // A SEAT IS RELATIVE TO THE CAR, and always was. Only this last line ever
  // needed a station: turning the seat into a place in the world. On the map
  // it asks the LINE instead (src/world/trains2d.ts), which means the same
  // thing at a platform, in a tunnel, and at the moment of crossing between.
  const at = seatOnMap(st, { ...f, rx, ry }, now);
  p.x = at ? at.x : t.x + rx;
  p.y = at ? at.y : t.centerY + f.ry;
}

export function land(p: Player, now: number) {
  p.jumpStart = 0;
  p.gliding = false;
  // never SHORTEN the dash cooldown set at dash start (this overwrite was
  // why dashing had no cooldown at all)
  p.jumpCdUntil = Math.max(p.jumpCdUntil, now + 120);
}

/**
 * Never start a player standing inside something solid. A bench or a
 * column on the spot you spawn on means you cannot move at all.
 */
