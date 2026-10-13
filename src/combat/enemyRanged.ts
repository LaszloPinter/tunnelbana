import type { Quarry } from './enemyTarget.ts';
import * as C from '../config.ts';
import { applyKnock } from './enemies.ts';
import type { CombatHost, Enemy } from './types.ts';
import { clamp, dist } from '../sim/det.ts';
import { seatDrift } from '../world/trainSeat.ts';

/**
 * The step toward the target this tick, and the ranged attacks woven into
 * it: the grottspindel's pounce and its acid, and the spitter's strafe,
 * holding its own range, flipping the strafe at random beats and whenever
 * an edge presses it, and the spit it winds up before the glob leaves.
 */
export function rangedVelocity(
  ctx: CombatHost,
  e: Enemy,
  tp: Quarry,
  tx: number,
  ty: number,
  range: number,
  speed: number,
  now: number,
): { x: number; y: number } {
  let vx = 0;
  let vy = 0;
  // a spit from a seat leaves with the car's speed under it, and stays
  // filed with the riders while it flies inside (combat/projectiles.ts)
  const aboardJid = e.frame.kind === 'aboard' ? e.frame.jid : undefined;
  const drift = aboardJid && e.frame.kind === 'aboard' ? seatDrift(aboardJid, e.frame.rx, now) : null;
  // grottspindel pounce: rears briefly, then launches at you
  if (e.type === 'spider' && e.aggro && range < C.M(11) && range > C.M(2) && now > e.shootCdUntil) {
    e.shootCdUntil = now + 2600;
    const d = range || 1;
    applyKnock(ctx, e, { x: (tx - e.x) / d, y: (ty - e.y) / d }, C.M(30));
  }
  // ...and hawks up acid globs that burn on the ground where they land
  if (
    e.type === 'spider' &&
    e.aggro &&
    range > C.M(3) &&
    range < C.M(14) &&
    now > e.acidAt &&
    tp.frame.kind === 'world'
  ) {
    e.acidAt = now + 4200;
    const gs = C.M(9);
    const d = range || 1;
    ctx.st.projs.push({
      frame: 'world',
      ti: 0,
      x: e.x,
      y: e.y,
      vx: ((tp.x - e.x) / d) * gs,
      vy: ((tp.y - e.y) / d) * gs,
      friendly: false,
      owner: -1,
      dieAt: now + clamp((range / gs) * 1000, 400, 1500),
      dmg: 0,
      pierce: 0,
      lastHit: -1,
      bounces: 0,
      color: 0x9be04a,
      isSplit: false,
      acid: true,
      id: ctx.run.nextProjId++,
    });
  }
  if (e.type !== 'spitter') {
    if (range > 1) {
      vx = ((tx - e.x) / range) * speed;
      vy = ((ty - e.y) / range) * speed;
    }
  } else {
    // holds ITS range (rolled at spawn) and strafes, flipping the strafe at
    // random beats and whenever an edge presses it, and shying off the edge,
    // so a line of them no longer ends up pooled along the platform lip
    const hold = e.approachMag;
    const want = range < hold - C.M(1.5) ? -1 : range > hold + C.M(2) ? 1 : 0;
    const ux = range > 1 ? (tx - e.x) / range : 1;
    const uy = range > 1 ? (ty - e.y) / range : 0;
    if (now >= e.approachAt) {
      e.approachAt = now + 700 + ctx.run.rng() * 1100;
      e.approachSide = ctx.run.rng() < 0.5 ? 1 : -1;
    }
    // ...and on the map there is no island edge to shy off: the floor itself
    // is what a body may not walk off (src/world/body2d.ts), so the strafe
    // simply runs and the ground stops it.
    const strafe = e.approachSide;
    vx = (ux * want + -uy * strafe * 0.7) * speed;
    vy = (uy * want + ux * strafe * 0.7) * speed;
    // spitters can hit you on the platform AND exposed on a joint, not
    // inside a car. The spit is WOUND UP first (from play: a spit with no
    // tell and no flight was a message and a number, not a thing to dodge):
    // the mouth opens, and 0.3 s later the glob leaves, slow enough to see
    if (e.spitAt === 0 && now > e.shootCdUntil && range < C.M(14) && tp.frame.kind !== 'aboard') {
      e.spitAt = now + 320;
      e.shootCdUntil = now + 2200;
    }
    if (e.spitAt > 0 && now >= e.spitAt) {
      e.spitAt = 0;
      const ps = C.M(9);
      // normalised by the distance to YOU, `range` can be the distance to a
      // column-detour corner, and a glob divided by 0.3 m left at 300 m/s
      // (measured: scripts/probe/spit.ts)
      const d = dist(tp.x - e.x, tp.y - e.y) || 1;
      ctx.st.projs.push({
        frame: 'world',
        ti: 0,
        jid: aboardJid,
        x: e.x,
        y: e.y,
        vx: ((tp.x - e.x) / d) * ps + (drift?.vx ?? 0),
        vy: ((tp.y - e.y) / d) * ps + (drift?.vy ?? 0),
        friendly: false,
        owner: -1,
        armAt: now + 180,
        dieAt: now + 2200,
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
  return { x: vx, y: vy };
}
