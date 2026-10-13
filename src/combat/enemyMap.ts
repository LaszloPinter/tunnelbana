import { pickQuarry, type Quarry } from './enemyTarget.ts';
import * as C from '../config.ts';
import { hurtEnemy, killedByTheWorld } from './enemyDeath.ts';
import { ENEMY_R, type CombatHost, type Enemy } from './types.ts';
import { datan2, dcos, dist, dsin } from '../sim/det.ts';
import { separation } from './enemyMotion.ts';
import { approachTarget, tempoPace } from './enemyApproach.ts';
import { rangedVelocity } from './enemyRanged.ts';
import { stepBoss } from './enemyBoss.ts';
import { tryBite } from './enemyAboard.ts';
import { packTarget, sidestep } from './enemyPack.ts';
import { stepBody } from '../world/body2d.ts';
import { bodyAt, doorPoints, trainBody } from '../world/trains2d.ts';
import { seatAt } from '../world/trainSeat.ts';

/**
 * THE HORDE ON THE MAP.
 *
 * One world, so one frame: a mob's x and y are places in Stockholm, the same
 * as yours, and everything it decides is decided in them. That is the whole
 * of this file, and the reason it exists apart from combat/enemyAI.ts, which
 * still speaks the old rooms' language: a platform's own x from its own left
 * end, a lateral measured from its centreline, islands and beds named by the
 * band of y they occupy. Reading a world position in those terms is not a
 * small error. A waypoint clamped into a room's span landed thousands of
 * metres away, so the horde walked off toward the map's origin instead of
 * toward the player, "enemies are going the wrong way" (from play
 * 2026-09-10), and the tick that returned early to move them on the map
 * never reached the bite at the end, so the ones that did arrive stood in
 * your face doing nothing.
 *
 * What holds them here is the map itself (src/world/body2d.ts): floor under
 * their feet, columns and benches in the way, and metal that is solid except
 * across an open doorway.
 */
export function stepEnemyMap(ctx: CombatHost, e: Enemy, speed: number, dt: number, now: number) {
  knock(ctx, e, dt, now);
  if (now < e.stunUntil) return;

  // ON THE MAP the nearest seat is the nearest seat: there is no room to be
  // outside of and nothing to map a target through.
  // the nearest seat, or a passenger, if one is much nearer (enemyTarget.ts)
  const tp = pickQuarry(ctx, e);
  // an elite holds its ward toward whoever it is after
  if (e.ward && tp) e.ward.angle = datan2(tp.y - e.y, tp.x - e.x);
  if (!tp) {
    wander(ctx, e, speed, now);
    return;
  }
  const distP = dist(tp.x - e.x, tp.y - e.y);
  if (!e.aggro) {
    const open = tp.frame.kind === 'aboard' ? ctx.run.railTrain(jidOf(ctx, tp)) : null;
    const sees = tp.frame.kind === 'world' ? distP < C.M(14) : !!open?.doorsOpen && distP < C.M(10);
    // the tutorial's dummies never turn: they are there to be shot at (waves.ts keepDummies)
    if (!sees || ctx.run.tutorial) {
      wander(ctx, e, speed, now);
      return;
    }
    e.aggro = true;
    e.nextWanderAt = 0;
  }

  speed *= tempoPace(ctx, e, now, distP);
  if (e.type === 'boss' && stepBoss(ctx, e, tp, now)) return;

  // WHERE IT IS HEADING: you, or, if you are on a train standing here with
  // its doors open, the nearest of those doors, which is the only way in.
  let tx = tp.x;
  let ty = tp.y;
  if (tp.frame.kind === 'aboard') {
    const door = nearestDoor(ctx, jidOf(ctx, tp), e, now);
    if (!door) {
      wander(ctx, e, speed, now);
      return;
    }
    tx = door.x;
    ty = door.y;
  } else if (e.type !== 'spitter') {
    const shaped = approachTarget(ctx, e, tp.x, tp.y, now);
    const packed = packTarget(ctx, e, tp, shaped.x, shaped.y);
    tx = packed.x;
    ty = packed.y;
  }
  sidestep(ctx, e, now);

  const range = dist(tx - e.x, ty - e.y);
  const vel = rangedVelocity(ctx, e, tp, tx, ty, range, speed, now);
  let vx = vel.x;
  let vy = vel.y;
  if (e.type !== 'boss') {
    const sep = separation(ctx, e, speed);
    vx += sep.x;
    vy += sep.y;
  }
  // THE WORLD HOLDS THEM, the same way it holds a walker. A mob may cross a
  // platform edge that a player needs a dash for, dropping onto the tracks
  // after you is how the horde has always hunted, so it steps as though
  // airborne.
  const moved = stepBody(ctx.run, ctx.run.map, e.x, e.y, vx, vy, ENEMY_R, true, true, e.slide);
  if (moved.crushed) {
    killedByTheWorld(ctx, e, now);
    return;
  }
  e.x = moved.x;
  e.y = moved.y;
  // the side it is going round something: kept while it is going round
  e.slide = moved.turn;
  // whichever room it is standing in now owns it: a lookup, not a crossing
  ctx.run.reroom(ctx.st, e);
  // ...and if it has walked in through an open door, it is aboard, the same
  // step a player makes (src/world/walk2d.ts boardHere)
  if (e.type !== 'troll' && boardIfInside(ctx, e, tp, now)) return;
  tryBite(ctx, e, now);
}

/** the journey a rider is on: a seat is on a TRAIN, not on the slot the train
 * happens to be standing in */
function jidOf(ctx: CombatHost, p: Quarry): string {
  if (p.frame.kind !== 'aboard') return '';
  return p.frame.jid ?? railsOf(ctx)[p.frame.ti]?.journey ?? '';
}

function railsOf(ctx: CombatHost): { journey?: string | null }[] {
  const st = ctx.st as unknown as { rails?: { journey?: string | null }[] };
  return st.rails ?? [];
}

/**
 * The nearest doorway of a train standing at a platform, as a point on the
 * map, aimed a little INSIDE the car, so a mob that reaches it walks
 * through rather than pressing its face to the opening.
 */
function nearestDoor(ctx: CombatHost, jid: string, e: Enemy, now: number) {
  const t = jid ? ctx.run.railTrain(jid) : null;
  if (!t || !t.active() || !t.doorsOpen) return null;
  // the doorways as points on the map, once per train position rather than
  // once per mob per tick: twenty-seven curve samples for each of fifty mobs
  const doors = doorPoints(jid, now, t.doors);
  if (!doors) return null;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const p of doors) {
    const dd = dist(p.x - e.x, p.y - e.y);
    if (dd >= bd) continue;
    bd = dd;
    // a step across the threshold: the car's centreline, not its doorway
    best = p;
  }
  return best;
}

/** standing in a doorway of the train your target is riding: get on it */
function boardIfInside(ctx: CombatHost, e: Enemy, tp: Quarry, now: number): boolean {
  if (tp.frame.kind !== 'aboard') return false;
  const jid = jidOf(ctx, tp);
  const t = jid ? ctx.run.railTrain(jid) : null;
  if (!t || !t.active() || !t.doorsOpen) return false;
  const body = trainBody(jid, ctx.run.gameNow);
  if (!body || bodyAt(body, e.x, e.y, -ENEMY_R * 0.5) === null) return false;
  const seat = seatAt(jid, ctx.run.gameNow, e.x, e.y);
  if (!seat) return false;
  const ti = railsOf(ctx).findIndex((r) => r.journey === jid);
  if (ti < 0) return false;
  e.frame = { kind: 'aboard', ti, rx: seat.rx, ry: seat.ry, jid };
  tryBite(ctx, e, now);
  return true;
}

/**
 * IDLING. A wander target is a point a few metres from where it stands, not
 * a fraction of a room's span, which is a number that means nothing out here,
 * and the walk to it goes through the floor like any other.
 */
function wander(ctx: CombatHost, e: Enemy, speed: number, now: number) {
  const here = ctx.run.map.at(e.x, e.y);
  // OFF THE TRACKS FIRST, AND QUICKLY. Standing on a bed is standing where a
  // train will be, and a wander's amble is not fast enough to matter: the
  // horde that had crowded the doors was still on the bed when the train
  // pulled out and it ran the lot of them down (from play 2026-09-11: "the
  // enemies pool in front of the train I boarded to be killed by the train").
  if (here?.kind === 'bed') {
    const off = offTheTracks(ctx, e);
    if (off) {
      e.wanderX = off.x;
      e.wanderY = off.y;
      e.nextWanderAt = now + 1200;
      const d = dist(off.x - e.x, off.y - e.y) || 1;
      const moved = stepBody(
        ctx.run,
        ctx.run.map,
        e.x,
        e.y,
        ((off.x - e.x) / d) * speed,
        ((off.y - e.y) / d) * speed,
        ENEMY_R,
        true,
        true,
      );
      if (moved.crushed) {
        killedByTheWorld(ctx, e, now);
        return;
      }
      e.x = moved.x;
      e.y = moved.y;
      ctx.run.reroom(ctx.st, e);
      return;
    }
  }
  if (now > e.nextWanderAt) {
    e.nextWanderAt = now + 2500 + ctx.run.rng() * 2500;
    // ...AND IT DOES NOT WANDER ONTO THE TRACKS. A mob hunting you will step
    // over an edge and take its chances, that is how the horde has always
    // hunted, but one with nothing to do has no business standing in front
    // of a train. Every station's idle horde was strolling onto the beds and
    // being run over off screen, and each of those deaths paid the party
    // experience (from play 2026-09-11: "somewhere mobs are dying so much I
    // keep getting level up").
    for (let tryAt = 0; tryAt < 6; tryAt++) {
      const x = e.x + (ctx.run.rng() - 0.5) * C.M(14);
      const y = e.y + (ctx.run.rng() - 0.5) * C.M(14);
      const on = ctx.run.map.at(x, y);
      if (!on || (here && on.kind !== here.kind)) continue;
      e.wanderX = x;
      e.wanderY = y;
      break;
    }
  }

  const d = dist(e.wanderX - e.x, e.wanderY - e.y);
  if (d <= 4) return;
  const s = speed * 0.35;
  const moved = stepBody(
    ctx.run,
    ctx.run.map,
    e.x,
    e.y,
    ((e.wanderX - e.x) / d) * s,
    ((e.wanderY - e.y) / d) * s,
    ENEMY_R,
    true,
    false,
  );
  if (moved.crushed) {
    killedByTheWorld(ctx, e, now);
    return;
  }
  // a wander that gets nowhere is a wander into a wall: pick again
  if (dist(moved.x - e.x, moved.y - e.y) < s * 0.2) e.nextWanderAt = 0;
  e.x = moved.x;
  e.y = moved.y;
  ctx.run.reroom(ctx.st, e);
}

/** a shove, on the map: the same debt it has always paid, but what it slams
 * into is asked of the floor rather than of a room's four numbers */
function knock(ctx: CombatHost, e: Enemy, dt: number, now: number) {
  if (e.kvx === 0 && e.kvy === 0) return;
  const moved = stepBody(ctx.run, ctx.run.map, e.x, e.y, e.kvx * dt, e.kvy * dt, ENEMY_R, true, false);
  const wall = dist(moved.x - e.x, moved.y - e.y) < dist(e.kvx * dt, e.kvy * dt) * 0.6;
  e.x = moved.x;
  e.y = moved.y;
  if (moved.crushed) {
    killedByTheWorld(ctx, e, now);
    return;
  }
  // THE IMPACT DEBT (impact lane): a body shoved by a heavy cast pays for
  // what it slams into, the wall, a column, or another body, which is shoved
  // on in turn while the shove has `through` left.
  if (e.impact) {
    let struck: Enemy | null = null;
    for (const o of ctx.st.enemies) {
      if (o === e || o.hp <= 0 || o.frame.kind !== 'world') continue;
      if (dist(o.x - e.x, o.y - e.y) < ENEMY_R * 2) {
        struck = o;
        break;
      }
    }
    if (wall || struck) {
      const debt = e.impact;
      e.impact = undefined;
      hurtEnemy(ctx, e, debt.dmg, now, null);
      if (struck) {
        hurtEnemy(ctx, struck, debt.dmg, now, null);
        if (debt.through > 1) {
          const d = dist(e.kvx, e.kvy) || 1;
          struck.kvx += (e.kvx / d) * C.M(16);
          struck.kvy += (e.kvy / d) * C.M(16);
          struck.impact = { dmg: debt.dmg, through: debt.through - 1 };
        }
      }
      e.kvx = 0;
      e.kvy = 0;
    }
  }
  e.kvx *= 0.86;
  e.kvy *= 0.86;
  if (dist(e.kvx, e.kvy) < C.M(0.8)) {
    e.kvx = 0;
    e.kvy = 0;
    e.impact = undefined;
  }
  ctx.run.reroom(ctx.st, e);
}

/** the nearest deck a body standing on the tracks can climb back onto */
function offTheTracks(ctx: CombatHost, e: Enemy): { x: number; y: number } | null {
  for (let ring = 1; ring <= 12; ring++) {
    const step = ring * C.M(1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x = e.x + dcos(a) * step;
      const y = e.y + dsin(a) * step;
      if (ctx.run.map.at(x, y)?.kind === 'platform') return { x, y };
    }
  }
  return null;
}
