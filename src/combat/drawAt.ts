import type { CombatHost } from './types.ts';

/**
 * WHERE A THING IS DRAWN, for the effects the combat system throws: a
 * ring, a spark, a chain. On the map a thing is already where it is, one
 * Stockholm, one frame, so the drawn y is the y.
 */
type Framed = { x: number; y: number };

/** the drawn y of an enemy, a player or a projectile, at its own x, or at `x` */
export function drawY(_ctx: CombatHost, o: Framed, _x = o.x, y = o.y): number {
  return y;
}
