import * as C from '../config.ts';
import { boostActive } from '../core/bag.ts';
import { giveToPassenger } from '../combat/paxTalk.ts';
import { openBag } from '../combat/langaren.ts';
import { seatOnMap } from '../world/trainSeat.ts';
import { nearFixture } from '../world/fixtures.ts';
import { stepWalk2d } from '../world/walk2d.ts';
import { land, stepAboard } from './ride.ts';
import { dashContacts } from '../combat/combat.ts';
import { tryBuy } from '../combat/machines.ts';
import { openShop } from '../combat/progression.ts';
import { dist } from './det.ts';
import { aimDir, airborne, dashing, type Player } from './player.ts';
import { BTN, PINGS } from './tick.ts';
import type { Run } from './run.ts';
import { atVendor } from './legWalk.ts';
import { nearExit, shaftAt, takeShaft } from './ground.ts';
import { ping, tryRevive } from './harm.ts';
import { arriveRide } from './chain.ts';

/**
 * One commuter's tick: the tracks, the dash, their movement in whichever
 * frame they are in, and what E does where they stand. Returns false when
 * the step changed the world under everyone (a station arrived on foot, a
 * shaft was taken, the run ended) and the tick should stop here.
 */
export function stepPlayer(run: Run, p: Player, dt: number, now: number): boolean {
  const st = run.placeOf(p);
  const host = run.hostFor(st);

  const input = p.input;
  // on the floor (§11c): you ride your frame, you decay your revive bar,
  // and you can call for help, nothing else
  if (p.downed) {
    if (p.frame.kind !== 'world') {
      const t = st.rails[p.frame.ti]?.train;
      // on the map the seat is a point on the train's line; the room's
      // numbers put a downed rider thousands of pixels from anyone who
      // could revive them
      const at = seatOnMap(st, p.frame, now);
      if (at) {
        p.x = at.x;
        p.y = at.y;
      } else if (t) {
        p.x = t.x + p.frame.rx;
        p.y = t.centerY + p.frame.ry;
      }
    }
    if (p.reviveProgress > 0 && now - p.reviveHeldAt > 60) {
      p.reviveProgress = Math.max(0, p.reviveProgress - 2 * dt);
    }
    if (input.pressed & (BTN.pingHere | BTN.pingTrain | BTN.pingHelp | BTN.pingWait))
      ping(run, p, BTN.pingHelp);
    p.movingInput = false;
    return true;
  }

  // the pings: canned calls, one shout each, shown to the whole party
  for (const pg of PINGS) {
    if (input.pressed & pg.bit) ping(run, p, pg.bit);
  }

  // a teammate on the floor beside you: holding E kneels and revives
  if (input.held & BTN.use && tryRevive(run, p, dt, now)) {
    p.movingInput = false;
    return true;
  }

  // cards up, or browsing the kiosk: you stand where you are while you
  // choose, and the world does not wait for you (past the grace, §16)
  if (p.offer) {
    p.movingInput = false;
    if ((p.offer.kind === 'shop' || p.offer.kind === 'bag') && input.pressed & BTN.use) p.offer = null;
    return true;
  }
  // A PUSH IS A VECTOR NO LONGER THAN ONE. Two keys make a diagonal of
  // length √2 and are brought back to one; a single key turned with the
  // view (scenes/input.ts) is already one and is left alone, it used to
  // be halved by the "both axes" rule; and a stick pushed halfway walks at
  // half pace, which is what a stick is for.
  let dx = input.mx;
  let dy = input.my;
  const len = dist(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  // the perks are capped; the tickets ride on top, uncapped (core/mods.ts ticketMove)
  const sp = C.PLAYER_SPEED * Math.min(C.MOVE_SPEED_CAP, p.mods.moveSpeed) * p.mods.ticketMove * dt;

  // the aura lane carries two dashes: spend them back to back, and each
  // regenerates on its own full cooldown, the 120 ms landing bump must
  // not refill a charge, so regeneration keys off dashRegenAt alone
  if (p.dashStock < p.mods.dashCharges && now >= p.dashRegenAt) {
    p.dashStock += 1;
    p.dashRegenAt = now + C.DASH_CD_MS * p.mods.dashCd * (boostActive(p, 'dash', now) ? 0.5 : 1);
  }
  if ((input.pressed & BTN.dash) !== 0 && !airborne(p, now) && p.dashStock > 0 && now > p.jumpCdUntil) {
    p.jumpStart = now;
    if (p.dashStock >= p.mods.dashCharges)
      p.dashRegenAt = now + C.DASH_CD_MS * p.mods.dashCd * (boostActive(p, 'dash', now) ? 0.5 : 1);
    p.dashStock -= 1;
    p.dashHit.clear();
    // dash along your movement input; standing still dashes toward the aim
    if (dx !== 0 || dy !== 0) {
      const dl = dist(dx, dy);
      p.dashDirX = dx / dl;
      p.dashDirY = dy / dl;
    } else {
      const a = aimDir(p);
      p.dashDirX = a.x;
      p.dashDirY = a.y;
    }
  }
  if (p.jumpStart !== 0 && now - p.jumpStart >= C.DASH_MS * p.mods.dashLen) {
    const f2 = p.frame;
    const blocked = f2.kind === 'aboard' && st.rails[f2.ti].train.seatBlocked(f2.rx, f2.ry, p.r);
    if (blocked) p.gliding = true;
    else land(p, now);
  }

  const isDashing = dashing(p, now);
  p.movingInput = dx !== 0 || dy !== 0 || isDashing;
  p.moveDirX = isDashing ? p.dashDirX : dx;
  p.moveDirY = isDashing ? p.dashDirY : dy;
  let mvx = dx * sp;
  let mvy = dy * sp;
  if (isDashing) {
    mvx = p.dashDirX * sp * C.DASH_SPEED_MUL;
    mvy = p.dashDirY * sp * C.DASH_SPEED_MUL;
  }

  if (p.frame.kind === 'world') {
    // ONE WORLD, ONE TICK (src/world/walk2d.ts)
    if (!stepWalk2d(run, p, mvx, mvy, now)) return false;
  } else stepAboard(run, st, p, mvx, mvy, now);
  if (!p.alive) return true;

  if (isDashing) dashContacts(host, p, now);

  // input belongs to the scene, not to the combat system: 1 is the bolt,
  // 2 the torrent; STÖT is a press, not a slot (combat/casting.ts)
  if (input.pressed & BTN.weapon1) p.weapon = 'pistol';
  // the torrent is base kit again since the lanes (everyone is a sorcerer)
  if (input.pressed & (BTN.weapon2 | BTN.weapon3)) p.weapon = 'smg';
  if (input.pressed & BTN.use) return useKey(run, p, now);
  return true;
}

/** what E means where you stand */
function useKey(run: Run, p: Player, now: number): boolean {
  // the dealer, wherever he and you are, a platform, a train (combat/langaren.ts)
  if (openBag(run, p, now)) return true;
  const st = run.placeOf(p);
  const host = run.hostFor(st);
  if (st.kind === 'leg') {
    // out in a bore E means exactly one thing: the vendor's window
    if (p.frame.kind === 'world' && atVendor(run, p)) openShop(host, p, now);
    return true;
  }
  // a shaft goes DOWN the station, an exit goes out of it: check the shaft
  // first, since at a multi-level station you will be standing on one far
  // more often than you mean to leave
  const shaft = shaftAt(st, p, p.x, p.y);
  if (shaft) {
    takeShaft(run, p, shaft, now);
    return false;
  }
  // leaving is deliberate: E at an escalator, never by touch. At the
  // destination it banks the ride and deals the next (sim/chain.ts);
  // anywhere else it cashes the run out.
  if (nearExit(st, p)) {
    // at any other station the chain goes on too, harder, with nothing banked
    arriveRide(run, p, now, st.name !== run.destStation);
    return false;
  }
  // somebody asking for a tenner, right beside you (combat/paxTalk.ts)
  if (giveToPassenger(run, p, now)) return true;
  // a kiosk window, any of them, one vendor: shuttered until cleared
  if (p.frame.kind === 'world' && nearFixture(st, st.kiosks, p.x, p.y, C.M(2.2))) {
    if (st.cleared) openShop(host, p, now);
    else run.showMsg('The kiosk is shuttered: clear the station.', now, p);
    return true;
  }
  tryBuy(host, p, now);
  return true;
}
