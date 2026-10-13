import { hurtPassenger } from '../sim/passenger.ts';
import * as C from '../config.ts';
import { drawY } from './drawAt.ts';
import { metalStops } from '../world/metal.ts';
import { inBody, trainBody } from '../world/trains2d.ts';
import type { Run } from '../sim/run.ts';
import { applyOnHit, applyKnock } from './enemies.ts';
import { hurtEnemy, nearestEnemyTo } from './enemyDeath.ts';
import { addStain, spawnAcidPool } from './hazards.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost, Proj } from './types.ts';
import { datan2, dcos, dist, dsin, clamp, wrapAngle } from '../sim/det.ts';
import { type Player } from '../sim/player.ts';
import { wardCovers, wardHit } from './shield.ts';
import { chainFrom, distToSeg, ramBlast } from './laneBolts.ts';
import { chargeHit } from './charge.ts';

/**
 * Bolts, torrent spray, spit and acid globs. On the map a projectile is a
 * point in Stockholm like the body that fired it; a car's side is a wall to
 * it except across an open door (world/metal.ts metalStops).
 */

export function stepProjectiles(ctx: CombatHost, dt: number, now: number) {
  const alive: Proj[] = [];
  for (const p of ctx.st.projs) {
    if (p.steppedAt === now) {
      alive.push(p);
      continue;
    }
    p.steppedAt = now;
    // DARK II: the boomerang. A spent or expiring bolt turns for home on a
    // curve, hits again on the way back, and is taken in by the caster's
    // hand. Out through them, back through them.
    const bOwner = p.friendly && !p.returning ? ctx.run.seatOf(p.owner) : undefined;
    if (bOwner && bOwner.mods.boomerang > 0 && (p.pierce <= 0 || now > p.dieAt - 400)) {
      p.returning = true;
      p.dieAt = now + 2600;
      p.pierce += 5;
      p.lastHit = -1;
    }
    if (p.returning) {
      const home = ctx.run.seatOf(p.owner);
      if (home && home.alive) {
        const hx = home.x;
        const hy = home.y;
        const cur = datan2(p.vy, p.vx);
        const tgt = datan2(hy - p.y, hx - p.x);
        const dA = clamp(wrapAngle(tgt - cur), -7 * dt, 7 * dt);
        const sp3 = dist(p.vx, p.vy);
        p.vx = dcos(cur + dA) * sp3;
        p.vy = dsin(cur + dA) * sp3;
        if (dist(hx - p.x, hy - p.y) < C.M(1)) {
          continue; // home: the hand takes it back
        }
      }
    }
    const pwx = p.x;
    const pwy = p.y;
    // whose cast this is: its perks ride with it, the owner's homing, chain
    // and split, not whoever happens to be looking
    const owner: Player | null = p.friendly ? (ctx.run.seatOf(p.owner) ?? null) : null;
    // Seeking Bolts: curve toward the target locked at cast (the enemy
    // nearest the CURSOR, not the projectile, no more sideways curving
    // at whatever stands next to you)
    if (owner && owner.mods.homing > 0 && p.targetId !== undefined) {
      const best = ctx.st.enemies.find((e) => e.id === p.targetId && e.hp > 0) ?? null;
      if (best) {
        const cur = datan2(p.vy, p.vx);
        const tgt = datan2(best.y - pwy, best.x - pwx);
        const dA = clamp(wrapAngle(tgt - cur), -owner.mods.homing * dt, owner.mods.homing * dt);
        const sp2 = dist(p.vx, p.vy);
        p.vx = dcos(cur + dA) * sp2;
        p.vy = dsin(cur + dA) * sp2;
      }
    }
    // on the map a bolt's velocity is what it looks like on screen, and the
    // map is the screen: it flies in a straight line
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.friendly) p.flown = (p.flown ?? 0) + dist(p.vx - (p.dvx ?? 0), p.vy - (p.dvy ?? 0)) * dt;
    let dead = now > p.dieAt;
    let mark = false;

    let wx = p.x;
    let wy = p.y;
    // A BOLT LIVES AS FAR AS THE WORLD IT IS IN. On the map that is the map:
    // it flies until it hits something or runs off the ground, and there is
    // no room to leave. Measuring its reach against a PLATFORM'S OWN span,
    // which is what a room's ends are, killed every shot on the first tick,
    // because a body's position means something else now (from play
    // 2026-09-10: "I can shoot but the projectiles are invisible").
    // What stops it: the ground running out (the tunnel wall), a car's side
    // (a shot goes through only where a door is open), and hard cover, a
    // column eats the shot, whoever fired it (world/chunks.ts blocked)
    const offGround = !ctx.run.map.solid(wx, wy);
    const onMetal = !offGround && metalStops(ctx.run as unknown as Run, pwx, pwy, wx, wy, 2);
    const inCover = !offGround && !onMetal && ctx.run.map.blocked(wx, wy, 2, 'pillar');
    if (!dead && (offGround || onMetal || inCover)) {
      dead = true;
      mark = !offGround;
    }
    // DARK II TURNS FOR HOME OFF WHATEVER STOPPED IT. The boomerang only
    // ever fired when a bolt outlived its pierce or its clock, and a bolt
    // meets the floor's edge, a column or a car long before either, so
    // the return never happened (from play 2026-09-16). Stopped, it stays
    // where it last flew and comes back through the horde.
    if (dead && !p.returning && owner && owner.mods.boomerang > 0 && !p.heavy) {
      dead = false;
      mark = false;
      p.returning = true;
      p.pierce += 5;
      p.lastHit = -1;
      const sp = dist(p.vx, p.vy);
      const dxh = owner.x - pwx;
      const dyh = owner.y - pwy;
      const dh = dist(dxh, dyh) || 1;
      p.vx = (dxh / dh) * sp;
      p.vy = (dyh / dh) * sp;
      wx = pwx;
      wy = pwy;
      p.x = pwx;
      p.y = pwy;
    }

    if (!dead && p.friendly) {
      for (const e of ctx.st.enemies) {
        if (e.hp <= 0 || e.id === p.lastHit) continue;
        // ON THE MAP a rider is standing somewhere in Stockholm like everyone
        // else, its seat is drawn on the line, not in a room of its own, so
        // a bolt reaches it if it reaches the place it is
        if (distToSeg(ctx, e.x, e.y, pwx, pwy, wx, wy) < e.r + 4) {
          // WHAT THIS HIT IS WORTH: the bolt's own damage, and Långskott's
          // share once it has flown far enough. Range and speed perks used
          // to live here and did nothing: a bolt already crossed the screen
          // and back (from play 2026-09-24).
          let dmg = p.dmg;
          if (owner && owner.mods.longShot > 0 && (p.flown ?? 0) >= C.LONG_SHOT_M)
            dmg *= 1 + owner.mods.longShot;
          // THE ELITE'S WARD: a bolt from the side it faces stops on it, and
          // whatever stands behind stays unhit until it is broken. A pierce
          // is still a bolt (combat/shield.ts); STÖT breaks it.
          if (wardCovers(e, pwx, pwy)) {
            wardHit(ctx, e, dmg, wx, wy, now);
            dead = true;
            break;
          }
          hurtEnemy(
            ctx,
            e,
            dmg,
            now,
            owner,
            p.pax ? (ctx.players.length > 0 ? 'helped' : 'unearned') : 'auto',
          );
          chargeHit(ctx, e, owner, dmg, now);
          if (owner) applyOnHit(ctx, owner, e, now);
          // a torrent pellet shoves along its own flight: a spray that
          // pushes the horde back rather than picking it off
          if (p.torrent) {
            const sp = dist(p.vx, p.vy) || 1;
            applyKnock(ctx, e, { x: p.vx / sp, y: p.vy / sp }, C.M(6));
          }
          if (owner && owner.mods.chain > 0) chainFrom(ctx, owner, e, now);
          p.lastHit = e.id;
          // THE RAM lands here: it detonates on the first body it reaches
          // and goes no further
          if (owner && p.heavy) {
            ramBlast(ctx, owner, p, e, e.x, e.y, now);
            p.spent = true;
            dead = true;
            break;
          }
          // dark II: bolts split into seekers on their final hit
          if (p.pierce > 0) {
            p.pierce -= 1;
            // a shot that goes through loses a quarter of itself per body
            // (from play: pierce ×2 was the whole line for free)
            if (p.friendly) p.dmg *= 0.75;
            pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), 3, 0xfff0b0, 2, 160, 0.8));
          } else {
            dead = true;
            if (owner && owner.mods.split > 0 && !p.isSplit) {
              const cur = datan2(p.vy, p.vx);
              for (const off of [-0.7, 0.7]) {
                ctx.st.projs.push({
                  frame: p.frame,
                  ti: p.ti,
                  jid: p.jid,
                  x: p.x,
                  y: p.y,
                  vx: dcos(cur + off) * C.M(24),
                  vy: dsin(cur + off) * C.M(24),
                  friendly: true,
                  owner: p.owner,
                  dieAt: now + 600,
                  dmg: 1,
                  pierce: 0,
                  lastHit: e.id,
                  bounces: 0,
                  color: p.color,
                  isSplit: true,
                  targetId: nearestEnemyTo(ctx, wx, wy, e.id),
                  id: ctx.run.nextProjId++,
                });
              }
            }
          }
          break;
        }
      }
    } else if (!dead && !p.friendly) {
      // the horde's spit hits whichever commuter it meets first, in seat
      // order, which is the order every client runs. Not before it is ARMED:
      // a glob that left a mouth beside you still has to fly
      for (const q of ctx.players) {
        if (dead || (p.armAt !== undefined && now < p.armAt)) break;
        if (!q.alive || q.downed) continue;
        if (distToSeg(ctx, q.x, q.y, pwx, pwy, wx, wy) < q.r + 4) {
          ctx.run.hurt(q, 10, 'Hit by spit!', now, pwx, pwy);
          dead = true;
          break;
        }
      }
      // ...and a passenger in its way takes it just the same (DESIGN §20)
      for (const q of ctx.run.pax) {
        if (dead || (p.armAt !== undefined && now < p.armAt)) break;
        if (!q.alive || q.frame.kind !== 'world' || p.frame !== 'world' || q.placeId !== ctx.st.id) continue;
        if (distToSeg(ctx, q.x, q.y, pwx, pwy, wx, wy) < q.r + 4) {
          hurtPassenger(ctx.run, q, 10, now);
          dead = true;
        }
      }
    }

    if (dead) {
      // a RAM that reached no body still lands: it goes off where it stops
      if (p.heavy && p.friendly && owner && !p.spent) ramBlast(ctx, owner, p, null, wx, wy, now);
      if (mark) addStain(ctx, p.frame, p.ti, wx, wy, 0x0a0a0a, 2, now);
      if (p.acid) spawnAcidPool(ctx, p.frame, p.ti, wx, wy, now);
    } else {
      // ON THE MAP A BOLT CHANGES ROOMS BY FLYING: the ground under it says
      // whose it is now, as it does for a body (world/metal.ts reroom). Kept
      // in the room it was cast in, a bolt fired down a bore reached the
      // platform beyond and hit nothing there, because that platform's horde
      // was never in its room (probe legfight, 0 of 4, 2026-09-16).
      // ...EXCEPT ABOARD. A rider is filed where the party is filed, not
      // where the tunnel under the train is, and so is a bolt flying down
      // the aisle, or it is stepped in a room whose horde is not the one it
      // was fired at (from play 2026-09-21: "hitting enemies while we are
      // both on the train, the hit doesn't register"; probe aboardfight).
      const body = p.jid ? trainBody(p.jid, now) : null;
      const inside = !!body && inBody(body, p.x, p.y);
      const on = inside ? null : ctx.run.map.at(p.x, p.y);
      if (on && on.place !== ctx.st) (on.place.projs as Proj[]).push(p);
      else alive.push(p);
    }
  }
  ctx.st.projs = alive;
}
