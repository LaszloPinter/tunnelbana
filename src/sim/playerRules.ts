import * as C from '../config.ts';
import { dist } from './det.ts';
import type { Player } from './player.ts';

/** the rules over one or several commuters: the ward's reach, dashing,
 * aim, who is where, every question the sim asks about players that is not
 * a field of one */

/** mid-dash: phasing through the horde, untouchable */
export const dashing = (p: Player, now: number): boolean =>
  p.jumpStart !== 0 && now - p.jumpStart < C.DASH_MS;

/** in the air: dashing, or gliding on past a blocked landing */
export const airborne = (p: Player, now: number): boolean =>
  p.jumpStart !== 0 && (now - p.jumpStart < C.DASH_MS || p.gliding);

/** the unit vector from the player toward the cursor, in path space */
export function aimDir(p: Player): { x: number; y: number } {
  const dx = p.input.aimX - p.x;
  const dy = p.input.aimY - p.y;
  const len = dist(dx, dy);
  return len > 1 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/**
 * The direction to the cursor as SEEN, from the player's drawn position to
 * the cursor's. Casts fly along this: a bolt is a physical thing in the world
 * the player is looking at, so it goes in a straight line across the screen,
 * whatever the platform is doing underneath it.
 */
export function aimWorld(p: Player, worldY: (x: number, y: number) => number): { x: number; y: number } {
  const dx = p.input.aimX - p.x;
  const dy = p.input.aimY - worldY(p.x, p.y);
  const len = dist(dx, dy);
  return len > 1 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/** is an enemy in this player's reach, same room, so to speak */
export function sameFrameAs(
  p: Pick<Player, 'frame'>,
  e: { frame: { kind: 'world' } | { kind: 'aboard'; ti: number } },
): boolean {
  const f = p.frame;
  if (f.kind === 'world') return e.frame.kind === 'world';
  // the joint is between the cars of THIS train: a rider aboard it can
  // reach you from the end of its car (from play, 2026-08-26: the joint
  // was the one place nothing could touch you). enemyAI.tryBite gives the
  // bite the extra reach across the gap
  return e.frame.kind === 'aboard' && e.frame.ti === f.ti;
}

/** the living players, in seat order, the order every loop must use */
export const alivePlayers = (players: Player[]): Player[] => players.filter((p) => p.alive);

/** the players still STANDING: alive and not on the floor */
export const activePlayers = (players: Player[]): Player[] => players.filter((p) => p.alive && !p.downed);

/**
 * The nearest living player to a point. Ties break by seat, so four clients
 * agree; the optional filter narrows it to players something can reach.
 */
export function nearestPlayer(
  players: Player[],
  x: number,
  y: number,
  ok: (p: Player) => boolean = () => true,
): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of players) {
    // the downed are not targets, not shoppers, not coin-collectors
    if (!p.alive || p.downed || !ok(p)) continue;
    const d = dist(p.x - x, p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** is any player still standing aboard train `ti`? (the downed ride, but do not steer the party) */
export const anyoneAboard = (players: Player[], ti: number): boolean =>
  players.some((p) => p.alive && !p.downed && p.frame.kind !== 'world' && p.frame.ti === ti);
