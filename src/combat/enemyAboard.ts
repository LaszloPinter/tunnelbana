import { paxAboard, paxInReach } from './enemyTarget.ts';
import { hurtPassenger } from '../sim/passenger.ts';
import * as C from '../config.ts';
import type { EnemyKind } from './types.ts';
import { sameFrame } from './enemies.ts';
import { ENEMY_R, type CombatHost, type Enemy } from './types.ts';
import { clamp, dist } from '../sim/det.ts';
import { nearestPlayer } from '../sim/player.ts';
import { aboardPoint, seatDrift } from '../world/trainSeat.ts';
import { doorNormalOf } from '../world/metal.ts';
import type { Run } from '../sim/run.ts';

/**
 * The horde ABOARD a car, sitting until you come close, chasing you down
 * the aisle, getting off when you are elsewhere, and the bite, wherever it
 * lands.
 */

export function stepEnemyAboard(ctx: CombatHost, e: Enemy, speed: number, now: number) {
  if (e.frame.kind !== 'aboard') return;
  const jid = e.frame.jid ?? ctx.st.rails[e.frame.ti]?.journey ?? undefined;
  /**
   * A RIDER IS ON A TRAIN, NOT IN A SLOT. A rail is a slot at one platform
   * and the fleet gives it to whatever pulls in next, so a rider still naming
   * the old slot is handed a STRANGER'S train: its seat is placed on its own
   * journey's line but clamped to the other train's bodywork, and the two
   * disagree every tick. That is the buzzing, a vätte vibrating inside a car
   * (from play 2026-09-12). Find the slot this journey is actually in.
   */
  const ti = jid ? findRail(ctx, jid, e.frame.ti) : e.frame.ti;
  const rail = ctx.st.rails[ti];
  if (!rail) return;
  if (ti !== e.frame.ti) e.frame.ti = ti;
  const t = rail.train;
  /**
   * WHICH WAY IS OUT, for a rider. A station's plan says the doors face +y
   * IN THAT ROOM; a seat on the map is measured across the train's own
   * travel, and at half the network's stops a service runs against the
   * room's axis. Taking the room's number there sends a vätte out through
   * the far side of the car and into the tunnel wall, where it stands
   * trapped (from play 2026-09-12). The player's side of this is
   * sim/ride.ts wayOut; this is the same question.
   */
  const out = jid ? doorNormalOf(ctx.run as unknown as Run, jid, ctx.run.gameNow) : t.doorSide;
  /**
   * A SEAT, SAID WHERE THE REST OF THE WORLD IS. Riding was always kept
   * relative to the car, so far along it, so far across, and only the last
   * line ever needed the room: turning that into a place. On the map the
   * train is a body laid along its own line (world/trains2d.ts), so the same
   * seat is asked of the line instead. Adding it to a station's own left edge
   * out here drops the rider at the map's origin.
   */

  const seatOut = (rx: number, ry: number): { x: number; y: number } => {
    const on = jid ? aboardPoint(jid, rx, ry, ctx.run.gameNow) : null;
    return on ?? { x: t.x + rx, y: t.centerY + ry };
  };
  const wallY = C.CAR_WIDTH / 2 - ENEMY_R - 1;
  let rx = e.frame.rx;
  let ry = e.frame.ry;

  // the nearest commuter riding THIS train, if any
  const tp = nearestPlayer(ctx.players, e.x, e.y, (q) => q.frame.kind !== 'world' && q.frame.ti === ti);
  // ...or a passenger riding it, if one is twice as near (DESIGN §20): the
  // horde aboard went for nobody but you (from play 2026-10-11)
  const pax = jid ? paxAboard(ctx, jid, e.x, e.y, tp ? dist(tp.x - e.x, tp.y - e.y) : Infinity) : null;
  const tf =
    pax && pax.frame.kind !== 'world' ? pax.frame : tp && tp.frame.kind !== 'world' ? tp.frame : null;
  const quarry = pax ?? tp;

  // a passive rider: sits in the car until you come close. Its rx is clamped
  // even while it sits, a train that re-cars beneath it (a short set where a
  // full one stood) otherwise leaves it hanging off the end of the bodywork
  if (!e.aggro) {
    if (quarry && dist(quarry.x - e.x, quarry.y - e.y) < C.M(9)) e.aggro = true;
    if (!e.aggro) {
      const seat = t.bodyAtRel(rx);
      rx = clamp(rx, seat.x0 + ENEMY_R + 1, seat.x1 - ENEMY_R - 1);
      e.frame.rx = rx;
      const at = seatOut(rx, ry);
      e.x = at.x;
      e.y = at.y;
      return;
    }
  }

  if (tf) {
    if (e.type !== 'spitter') {
      // chase the player in train-local space (units are sealed, no gap crossing)
      const dx = tf.rx - rx;
      const dy = tf.ry - ry;
      const d = dist(dx, dy);
      if (d > 1) {
        rx += (dx / d) * speed;
        ry += (dy / d) * speed;
      }
    } else {
      // spitter aboard: hold distance down the aisle and spit, camping the
      // car means eating ranged fire in a corridor
      const dxp = tf.rx - rx;
      const adx = Math.abs(dxp);
      if (adx < C.M(3)) rx -= Math.sign(dxp) * speed;
      else if (adx > C.M(7)) rx += Math.sign(dxp) * speed * 0.8;
      ry += clamp(-ry, -speed * 0.6, speed * 0.6);
      if (e.spitAt === 0 && now > e.shootCdUntil) {
        e.spitAt = now + 320;
        e.shootCdUntil = now + 2400;
      }
      if (e.spitAt > 0 && now >= e.spitAt) {
        e.spitAt = 0;
        const ps = C.M(9);
        // aimed down the aisle, and said where everything else is said: on
        // the map that is the world, WITH the car's own speed under it, and
        // filed with the riders (jid) like a bolt cast aboard (combat/casting.ts).
        // Without the drift a glob flew at its own speed in world coordinates
        // while the car ran under it: toward the back it closed at glob speed
        // plus train speed, toward the front it never arrived. Without the jid
        // the stepper re-filed it by the ground under it, the tunnel, whose
        // players do not include the riders, so it could never hit (from play
        // 2026-09-24: "spitters cannot hit me while we are on the train, and
        // their shots fly extra fast toward the back"; probe aboardfight).
        const from = seatOut(rx, ry);
        const to = seatOut(tf.rx, tf.ry);
        const away = dist(to.x - from.x, to.y - from.y) || 1;
        const carried = jid ? seatDrift(jid, rx, now) : null;
        ctx.st.projs.push({
          frame: 'world',
          ti,
          jid,
          x: from.x,
          y: from.y,
          vx: ((to.x - from.x) / away) * ps + (carried?.vx ?? 0),
          vy: ((to.y - from.y) / away) * ps + (carried?.vy ?? 0),
          friendly: false,
          armAt: now + 180,
          owner: -1,
          dieAt: now + 1400,
          dmg: 0,
          pierce: 0,
          lastHit: -1,
          bounces: 0,
          color: 0x9fef8f,
          isSplit: false,
          id: ctx.run.nextProjId++,
        });
      }
    }
  } else if (t.phase === 'dwell') {
    // player is elsewhere: head for the nearest door and get off
    let bestD = Infinity;
    let doorX = rx;
    for (const d of t.doors) {
      const c = (d.x0 + d.x1) / 2;
      if (Math.abs(c - rx) < bestD) {
        bestD = Math.abs(c - rx);
        doorX = c;
      }
    }
    rx += Math.sign(doorX - rx) * Math.min(speed, Math.abs(doorX - rx));
    if (Math.abs(doorX - rx) < C.M(0.4) && t.passableAtRel(rx, ENEMY_R)) ry += out * speed;
    if (ry * out >= C.CAR_WIDTH / 2) {
      e.frame = { kind: 'world' };
      // off through the doorway and onto the deck: a step across the
      // threshold, which on the map is a step out along the car's own normal
      const off = seatOut(rx, out * (C.CAR_WIDTH / 2 + ENEMY_R + C.M(0.8)));
      e.x = off.x;
      e.y = off.y;
      return;
    }
  }

  const body = t.bodyAtRel(rx);
  rx = clamp(rx, body.x0 + ENEMY_R + 1, body.x1 - ENEMY_R - 1);
  if (!(t.passableAtRel(rx, ENEMY_R) && ry * out > wallY)) {
    ry = clamp(ry, -wallY, wallY);
  }
  e.frame.rx = rx;
  e.frame.ry = ry;
  const here = seatOut(rx, ry);
  e.x = here.x;
  e.y = here.y;
  tryBite(ctx, e, now);
}

const BITES: Record<EnemyKind, [number, number, string]> = {
  runner: [900, 8, 'A vätte bit you!'],
  spitter: [900, 0, ''],
  troll: [1300, 22, 'A troll clubbed you!'],
  spider: [900, 14, 'The grottspindel sank its fangs in!'],
  boss: [1600, 30, 'BERGAKUNGEN struck you down!'],
  daemon: [1400, 20, 'The cacodaemon tore into you!'],
};

export function tryBite(ctx: CombatHost, e: Enemy, now: number) {
  if (e.type === 'spitter' || now < e.hitCdUntil) return;
  // the nearest commuter it can actually reach, same car, same floor.
  // ON THE MAP that is every seat: a room is a lookup on the floor now, and
  // a mob standing in your face while you are counted into the platform and
  // it into the tunnel mouth is a mob that never bites you (from play
  // 2026-09-10: "they don't damage me when they get to me").
  const p = nearestPlayer(ctx.run.players, e.x, e.y, (q) => sameFrame(q, e));
  const [cd, dmg, msg] = BITES[e.type];
  if (!p || dist(e.x - p.x, e.y - p.y) >= p.r + e.r + 2) {
    // no seat in reach: a passenger standing in its face will do (DESIGN §20)
    const q = paxInReach(ctx, e);
    if (q) {
      e.hitCdUntil = now + (e.variant === 'brute' ? cd + 400 : cd);
      hurtPassenger(ctx.run, q, dmg + variantBite(e), now);
    }
    return;
  }
  {
    e.hitCdUntil = now + (e.variant === 'brute' ? cd + 400 : cd);
    ctx.run.hurt(
      p,
      dmg + variantBite(e),
      e.variant === 'brute' ? 'A brute of a vätte mauled you!' : msg,
      now,
      e.x,
      e.y,
    );
  }
}

/** a brute's jaws, a runt's nip, and the tunnel's own, which bites double */
export function variantBite(e: Enemy): number {
  if (e.variant === 'brute') return 8;
  if (e.variant === 'runt') return -3;
  // a quick vätte hits for twice a plain one's 8 (types.ts Variant)
  if (e.variant === 'quick') return 8;
  return 0;
}

/** the slot this journey is standing in here, or the one it was last in */
function findRail(ctx: CombatHost, jid: string, was: number): number {
  if (ctx.st.rails[was]?.journey === jid) return was;
  const i = ctx.st.rails.findIndex((r) => r.journey === jid);
  return i >= 0 ? i : was;
}
