import * as C from '../config.ts';
import type { EnemyKind } from './types.ts';
import { type CombatHost, type Enemy } from './types.ts';
import { stepEnemyAboard } from './enemyAboard.ts';
import { integrateKnock } from './enemyMotion.ts';
import { stepEnemyMap } from './enemyMap.ts';

/**
 * What the horde DOES: one tick of one mob. On the floor it is the map's
 * walker (enemyMap.ts); aboard a car it is a rider (enemyAboard.ts). The
 * rest of its behaviour is a module each, the king (enemyBoss.ts), the
 * ranged manners (enemyRanged.ts), the approach lines and rhythms
 * (enemyApproach.ts), and the physics it shares (enemyMotion.ts).
 */

export function stepEnemy(ctx: CombatHost, e: Enemy, dt: number, now: number) {
  if (e.steppedAt === now) return;
  e.steppedAt = now;
  if (e.hp <= 0) return;
  // fire element: burn ticks
  const slow = now < e.slowUntil ? 0.55 : 1;
  const SPEEDS: Record<EnemyKind, number> = {
    runner: 4.5,
    spitter: 3.5,
    troll: 2.3,
    spider: 3.4,
    // 1.9 was a blob you could stroll away from (from play 2026-09-25)
    boss: 2.6,
    daemon: 4.2,
  };
  const speed = C.M(SPEEDS[e.type]) * e.speedMul * slow * dt;
  // ONE WORLD, ONE FRAME. Everything below this line is written in a room's
  // own terms, a platform's x from its left end, a lateral from its
  // centreline, islands and beds named by bands of y, and a body on the map
  // is not measured in any of them. The map's horde is its own tick
  // (combat/enemyMap.ts); riding a car is the same either way, because a seat
  // was always kept relative to the car.
  if (e.frame.kind !== 'aboard') {
    stepEnemyMap(ctx, e, speed, dt, now);
    return;
  }
  integrateKnock(ctx, e, dt, now);
  if (now < e.stunUntil) {
    return;
  }
  stepEnemyAboard(ctx, e, speed, now);
}
