import { dist } from '../sim/det.ts';
import { nearestPlayer, type Player } from '../sim/player.ts';
import type { Passenger } from '../sim/passenger.ts';
import type { CombatHost, Enemy } from './types.ts';

/** what the horde can go after: a seat or a passenger, it only needs to know where */
export type Quarry = Pick<Player, 'x' | 'y' | 'r' | 'frame'>;

/**
 * PASSENGERS ARE THE HORDE'S SECOND CHOICE (DESIGN §20): a passenger is
 * only chosen over the nearest player when it is this many times nearer.
 * The horde wants you; a guard in its face is still a guard in its face.
 */
export const PAX_BIAS = 2;

/** the nearest passenger on foot, judged at PAX_BIAS, list order breaks ties, which every client shares */
function nearestPax(ctx: CombatHost, x: number, y: number, within: number): Passenger | null {
  let best: Passenger | null = null;
  let bd = within;
  // only where the party is, and only who stands HERE (stepPassengers' rule)
  if (ctx.players.length === 0) return null;
  for (const q of ctx.run.pax) {
    if (!q.alive || q.frame.kind !== 'world' || q.placeId !== ctx.st.id) continue;
    const d = dist(q.x - x, q.y - y) * PAX_BIAS;
    if (d < bd) {
      best = q;
      bd = d;
    }
  }
  return best;
}

/** who an enemy on the floor goes after: the nearest player, unless a passenger is much nearer */
export function pickQuarry(ctx: CombatHost, e: Enemy): Quarry | null {
  const p = nearestPlayer(ctx.run.players, e.x, e.y);
  const dp = p ? dist(p.x - e.x, p.y - e.y) : Infinity;
  return nearestPax(ctx, e.x, e.y, dp) ?? p;
}

/** a passenger standing within `reach` of this enemy, to bite when no seat is in reach */
export function paxInReach(ctx: CombatHost, e: Enemy): Passenger | null {
  if (ctx.players.length === 0) return null;
  // on the floor, those standing here; in a car, those riding in it
  const jid = enemyJid(ctx.st, e);
  for (const q of ctx.run.pax) {
    if (!q.alive) continue;
    if (
      jid ? q.frame.kind !== 'aboard' || q.jid !== jid : q.frame.kind !== 'world' || q.placeId !== ctx.st.id
    )
      continue;
    if (dist(q.x - e.x, q.y - e.y) < q.r + e.r + 2) return q;
  }
  return null;
}

/** a passenger riding train `jid`, nearer than `within` judged at PAX_BIAS, for the horde aboard */
export function paxAboard(
  ctx: CombatHost,
  jid: string,
  x: number,
  y: number,
  within: number,
): Passenger | null {
  if (ctx.players.length === 0) return null;
  let best: Passenger | null = null;
  let bd = within;
  for (const q of ctx.run.pax) {
    if (!q.alive || q.frame.kind !== 'aboard' || q.jid !== jid) continue;
    const d = dist(q.x - x, q.y - y) * PAX_BIAS;
    if (d < bd) {
      best = q;
      bd = d;
    }
  }
  return best;
}

/**
 * THE TRAIN AN ENEMY ABOARD IS ON. A crawl-in is filed by its rail and
 * often carries no journey id of its own; comparing frame.jid alone found
 * no one aboard anything, and the horde in a car never saw a passenger in
 * it (from play 2026-10-11).
 */
export function enemyJid(st: { rails: { journey?: string | null }[] }, e: Enemy): string | null {
  if (e.frame.kind !== 'aboard') return null;
  return e.frame.jid ?? st.rails[e.frame.ti]?.journey ?? null;
}
