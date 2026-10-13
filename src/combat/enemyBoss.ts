import type { Quarry } from './enemyTarget.ts';
import * as C from '../config.ts';
import { drawY } from './drawAt.ts';
import { spawnEnemy } from './enemies.ts';
import { sameFrame } from './enemies.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost, Enemy } from './types.ts';
import { dcos, dist, dsin } from '../sim/det.ts';
import { alivePlayers } from '../sim/player.ts';

/**
 * BERGAKUNGEN: the leap, the marks and the summons.
 *
 * THE MARKS (the user's call, 2026-09-25): he was a slow blob whose only
 * blow landed around his own feet. Now he marks the ground where you stand
 * from as far as twenty-four metres, a ring grows there for a second, then
 * the mountain comes down on it, hard, and he keeps up to three marks at
 * once, so the fight is stepping out of the circles while he closes. The
 * leap still brings him to your island, and the bounce on landing still
 * throws everything near him. Every so often the mountain answers him with
 * vättar up the nearest stairs. Returns true when the king is busy and the
 * ordinary chase must not run this tick.
 */
/** how far the marks reach, how long one takes to fall, how wide it lands, what it costs */
const MARK_RANGE = C.M(24);
const MARK_WINDUP_MS = 1300;
const MARK_R = C.M(3.2);
const MARK_DMG = 34;
/** a beat between marks, three in the air before the first lands, then the fourth waits for one to fall */
const MARK_CD_MS = 450;
const MARK_MAX = 3;
export function stepBoss(ctx: CombatHost, e: Enemy, tp: Quarry, now: number): boolean {
  // THE LEAP (decided in chat 2026-08-25, K1): stand on the other island
  // and the mountain comes to you. A ring grows where he will land for a
  // second, then he is there, and the slam follows on the bounce.
  if (e.leapAt > 0) {
    if (now >= e.leapAt) {
      e.leapAt = 0;
      e.x = e.leapX;
      e.y = e.leapY;
      pushFx(ctx.run.fx, { kind: 'shake', ms: 320, power: 0.012 });
      pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), C.M(1), 0xd8c06a, 5, 320, 0.9, 6.6));
      e.slamAt = now + 700;
      e.hitCdUntil = now + 3200;
      pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), C.M(4.2), 0xd8c06a, 2, 700, 0.35, 6.55));
    }
    return true; // in the air
  }
  if (e.slamAt > 0) {
    if (now >= e.slamAt) {
      e.slamAt = 0;
      const R = C.M(4.2);
      pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), C.M(1), 0xd8c06a, 5, 320, 0.9, 6.6));
      pushFx(ctx.run.fx, { kind: 'shake', ms: 240, power: 0.008 });
      for (const q of alivePlayers(ctx.players)) {
        if (!sameFrame(q, e)) continue;
        if (dist(q.x - e.x, q.y - e.y) < R + q.r)
          ctx.run.hurt(q, 24, 'The mountain came down on you!', now, e.x, e.y);
      }
    }
    return true; // rooted while it builds
  }
  // THE MARKS LAND, then are forgotten
  for (const m of e.marks) {
    if (now < m.at) continue;
    pushFx(ctx.run.fx, ring(m.x, ctx.st.worldY(m.x, m.y), C.M(1), 0xd8c06a, 5, 320, 0.9, 6.6));
    pushFx(ctx.run.fx, { kind: 'shake', ms: 200, power: 0.007 });
    for (const q of alivePlayers(ctx.players)) {
      if (!sameFrame(q, e)) continue;
      if (dist(q.x - m.x, q.y - m.y) < MARK_R + q.r)
        ctx.run.hurt(q, MARK_DMG, 'The mountain came down on you!', now, m.x, m.y);
    }
  }
  if (e.marks.some((m) => now >= m.at)) e.marks = e.marks.filter((m) => now < m.at);
  // ...and a new one is laid under your feet, a little off the last, so
  // three together deny an area rather than one spot
  const range = dist(tp.x - e.x, tp.y - e.y);
  if (e.marks.length < MARK_MAX && now >= e.shootCdUntil && range < MARK_RANGE && sameFrame(tp, e)) {
    e.shootCdUntil = now + MARK_CD_MS;
    const spread = e.marks.length === 0 ? 0 : C.M(2.4);
    const ang = ctx.run.rng() * Math.PI * 2;
    const r = ctx.run.rng() * spread;
    const x = tp.x + dcos(ang) * r;
    const y = tp.y + dsin(ang) * r;
    e.marks.push({ x, y, at: now + MARK_WINDUP_MS });
    pushFx(ctx.run.fx, ring(x, ctx.st.worldY(x, y), MARK_R, 0xd8c06a, 1.15, MARK_WINDUP_MS, 0.45, 6.55));
    pushFx(
      ctx.run.fx,
      ring(x, ctx.st.worldY(x, y), C.M(0.6), 0xd8c06a, MARK_R / C.M(0.6), MARK_WINDUP_MS, 0.3, 6.54),
    );
    // said once per fight, the first time he does it
    if (!e.saidMarks) {
      e.saidMarks = true;
      ctx.showMsg('BERGAKUNGEN marks the ground: get out of the circles!', now);
    }
  }
  if (now >= e.acidAt) {
    e.acidAt = now + 11_000;
    let best = ctx.st.escalators[0];
    let bd = Infinity;
    for (const esc of ctx.st.escalators) {
      const d = dist(esc.x - e.x, esc.y - e.y);
      if (d < bd) {
        bd = d;
        best = esc;
      }
    }
    if (best) {
      for (let i = 0; i < 3; i++)
        spawnEnemy(
          ctx,
          'runner',
          { kind: 'world' },
          best.x + (ctx.run.rng() - 0.5) * C.M(2),
          best.y - ctx.run.rng() * C.M(1.5),
          true,
        );
      ctx.showMsg('The mountain answers its king…', now);
    }
  }
  return false;
}
