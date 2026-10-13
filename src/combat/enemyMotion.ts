import * as C from '../config.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { ENEMY_R, type CombatHost, type Enemy } from './types.ts';
import { clamp, dist } from '../sim/det.ts';

/**
 * The physics the horde shares: how a rider is shoved about inside a car,
 * and the elbow room the horde keeps. The map's own walker has its own
 * shove and idle (combat/enemyMap.ts).
 */

export function integrateKnock(ctx: CombatHost, e: Enemy, dt: number, now: number) {
  if (e.kvx === 0 && e.kvy === 0) return;
  if (e.frame.kind !== 'aboard') return;
  const t = ctx.st.rails[e.frame.ti].train;
  const wallY = C.CAR_WIDTH / 2 - ENEMY_R - 1;
  const body = t.bodyAtRel(e.frame.rx);
  e.frame.rx = clamp(e.frame.rx + e.kvx * dt, body.x0 + ENEMY_R, body.x1 - ENEMY_R);
  e.frame.ry = clamp(e.frame.ry + e.kvy * dt, -wallY, wallY);
  // on the map the seat is a point on the train's line, not room x plus
  // seat; the room's numbers left a shoved rider judging its aggro range
  // and the ward from a point that is nowhere
  const jid = e.frame.jid ?? ctx.st.rails[e.frame.ti]?.journey;
  const at = jid ? aboardPoint(jid, e.frame.rx, e.frame.ry, now) : null;
  e.x = at ? at.x : t.x + e.frame.rx;
  e.y = at ? at.y : t.centerY + e.frame.ry;
  e.kvx *= 0.86;
  e.kvy *= 0.86;
  if (dist(e.kvx, e.kvy) < C.M(0.8)) {
    e.kvx = 0;
    e.kvy = 0;
    // a shove that lands on nothing is a shove, not a slam
    e.impact = undefined;
  }
}

/**
 * Elbow room: the horde keeps a body's width between its members, so a
 * wave arrives as a row of mouths with gaps, not one stack drawn on the
 * same pixel. A shove only, never enough to stop the chase.
 */
export function separation(ctx: CombatHost, e: Enemy, speed: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const o of ctx.st.enemies) {
    if (o === e || o.hp <= 0 || o.frame.kind !== 'world') continue;
    const ddx = e.x - o.x;
    const ddy = e.y - o.y;
    const want = (e.r + o.r) * 1.15;
    const d = dist(ddx, ddy);
    if (d >= want) continue;
    if (d < 0.5) {
      // dead on top of one another: split by id so both pick a side
      sx += e.id > o.id ? 1 : -1;
      continue;
    }
    const push = (want - d) / want;
    sx += (ddx / d) * push;
    sy += (ddy / d) * push;
  }
  const sl = dist(sx, sy);
  if (sl === 0) return { x: 0, y: 0 };
  const cap = Math.min(sl, 1.4) * speed;
  return { x: (sx / sl) * cap, y: (sy / sl) * cap };
}
