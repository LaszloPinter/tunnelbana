import type { Quarry } from './enemyTarget.ts';
import * as C from '../config.ts';
import type { CombatHost, Enemy } from './types.ts';
import { datan2, dcos, dist, dsin } from '../sim/det.ts';
import { applyKnock } from './enemies.ts';

/**
 * THE PACK THAT THINKS (sim/chain.ts: a share of the horde from the second
 * ride on). Two habits, both from the user's brief for the chain, "better
 * pathing, more strategic herd, not always running towards the player
 * taking all the hits, possibly attempting to dodge bullets":
 *
 *   THE RING. When the bite is already crowded, three or more at the
 *   target's feet, a smart vätte does not queue in the pierce line behind
 *   them. It holds a ring at four and a half metres on its own side and
 *   circles, and comes in when the crowd thins. You are surrounded, not
 *   funnelled.
 *
 *   THE SIDESTEP. A friendly bolt coming down its line, within four metres,
 *   is stepped off, once, then not again for most of a second, as a shove
 *   the ordinary knock integrates (enemyMap.ts). It reads as a flinch out
 *   of the way, and it is only ever a step: a torrent's spray still finds it.
 */

/** how many are already at the target's feet */
function atTheBite(ctx: CombatHost, e: Enemy, tp: Quarry): number {
  let n = 0;
  for (const o of ctx.st.enemies) {
    if (o === e || o.hp <= 0 || o.frame.kind !== 'world') continue;
    if (dist(o.x - tp.x, o.y - tp.y) < C.M(2.4)) n += 1;
  }
  return n;
}

/** where a smart vätte heads instead of straight in, if the bite is crowded */
export function packTarget(
  ctx: CombatHost,
  e: Enemy,
  tp: Quarry,
  tx: number,
  ty: number,
): { x: number; y: number } {
  if (!e.smart || e.type !== 'runner' || tp.frame.kind !== 'world') return { x: tx, y: ty };
  const d = dist(tp.x - e.x, tp.y - e.y);
  if (d < C.M(3) || atTheBite(ctx, e, tp) < 3) return { x: tx, y: ty };
  const ang = datan2(e.y - tp.y, e.x - tp.x) + e.approachSide * 0.6;
  const R = C.M(4.5);
  const hx = tp.x + dcos(ang) * R;
  const hy = tp.y + dsin(ang) * R;
  return ctx.run.map.at(hx, hy) ? { x: hx, y: hy } : { x: tx, y: ty };
}

/** a bolt coming down its line: step off it, as a shove */
export function sidestep(ctx: CombatHost, e: Enemy, now: number) {
  if (!e.smart || now < e.dodgeAt || e.frame.kind !== 'world') return;
  for (const p of ctx.st.projs) {
    if (!p.friendly || p.frame !== 'world') continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const d = dist(dx, dy);
    if (d > C.M(4) || d < 1) continue;
    const sp = dist(p.vx, p.vy) || 1;
    const ux = p.vx / sp;
    const uy = p.vy / sp;
    if (dx * ux + dy * uy < 0) continue; // going the other way
    const lateral = -dx * uy + dy * ux;
    if (Math.abs(lateral) > e.r * 1.6) continue; // would miss anyway
    const s = lateral >= 0 ? 1 : -1;
    applyKnock(ctx, e, { x: -uy * s, y: ux * s }, C.M(9));
    e.dodgeAt = now + 800;
    return;
  }
}
