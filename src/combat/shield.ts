import * as C from '../config.ts';
import { drawY } from './drawAt.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost, Enemy } from './types.ts';
import { dcos, dist, dsin } from '../sim/det.ts';

/**
 * THE WARD, HELD BY THE HORDE.
 *
 * It was the player's: a barrier raised toward the way you faced, that ate
 * what came at it. Nobody raised it, the run is about moving, and a wall
 * you stand behind is a wall you stand behind. So the barrier changed
 * hands: an ELITE holds one toward whoever it is after, and the vättar
 * crowding behind it cannot be hit until it is broken. A pierce stops on
 * it like anything else; a bore goes through (from play 2026-09-17).
 *
 * The player's press on that key is STÖT now (combat/casting.ts).
 */

/** does the ward stand between its holder and this point? */
export function wardCovers(e: Enemy, sx: number, sy: number): boolean {
  const w = e.ward;
  if (!w || w.hp <= 0) return false;
  const dx = sx - e.x;
  const dy = sy - e.y;
  const d = dist(dx, dy) || 1;
  return (dx * dcos(w.angle) + dy * dsin(w.angle)) / d >= C.SHIELD_DOT;
}

/** the ward takes a hit from that side; true when it broke on this one */
export function wardHit(ctx: CombatHost, e: Enemy, n: number, sx: number, sy: number, now: number): boolean {
  const w = e.ward;
  if (!w || w.hp <= 0) return false;
  w.hp -= n;
  const R = e.r * 2.2;
  const sd = dist(sx - e.x, sy - e.y) || 1;
  const dy = drawY(ctx, e);
  pushFx(
    ctx.run.fx,
    ring(e.x + ((sx - e.x) / sd) * R, dy + ((sy - e.y) / sd) * R, 6, 0xd8b0ff, 2, 180, 1, 6.7),
  );
  if (w.hp > 0) return false;
  w.hp = 0;
  pushFx(ctx.run.fx, ring(e.x, dy, R, 0xd8b0ff, 3, 320, 0.7, 6.7));
  ctx.showMsg('Its ward shatters!', now);
  return true;
}
