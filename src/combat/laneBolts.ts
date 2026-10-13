import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { drawY } from './drawAt.ts';
import type { Player } from '../sim/player.ts';
import { applyKnock } from './enemies.ts';
import { hurtEnemy } from './enemyDeath.ts';
import { pushFx, ring, shake } from './fx.ts';
import type { CombatHost, Enemy, Proj } from './types.ts';
import { chargeHit } from './charge.ts';

// ---- the ram lane (core/lanes.ts); laddning lives in charge.ts ----

export function ramBlast(
  ctx: CombatHost,
  owner: Player,
  p: Proj,
  struck: Enemy | null,
  x: number,
  y: number,
  now: number,
) {
  const strong = owner.mods.ramThrough >= 2;
  const radius = C.M(strong ? 3.4 : 2.6);
  const dmg = p.dmg * (strong ? 1.2 : 1);
  // ...AT THE HEIGHT THE BLAST ACTUALLY WENT OFF. A ram fired aboard a
  // moving train detonates in the train's frame, and the drawn y of that is
  // the car's track wherever it has swung to, read on the bare ground
  // curve instead, the fireball hung out in the tunnel above the car (from
  // play 2026-09-06).
  const cy = drawY(ctx, p, x, y);
  // THE RING ENDS ON THE BLAST'S EDGE. `ring` draws its radius and then
  // tweens the scale to `grow`, so a ring drawn AT the radius balloons to
  // five times it, the picture promised a blast the damage never had
  // (from play 2026-09-05).
  pushFx(ctx.run.fx, ring(x, cy, radius * 0.55, 0xff9a5c, 1 / 0.55, 320, 0.95, 6.4));
  pushFx(ctx.run.fx, ring(x, cy, radius * 0.25, 0xffe0b0, 2, 200, 0.85, 6.42));
  // ...and it is felt, for whoever threw it
  if (owner.id === ctx.run.localId) pushFx(ctx.run.fx, shake(150, 0.004));
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0) continue;
    if (e.frame.kind !== 'world') continue;
    const d = dist(e.x - x, e.y - y);
    if (d > radius) continue;
    hurtEnemy(ctx, e, e === struck ? dmg : dmg * 0.12, now, owner);
    // a ram lands three charges at once (charge.ts): every ram is a detonation
    if (e === struck) chargeHit(ctx, e, owner, dmg, now, 3);
    if (e.hp <= 0) continue;
    applyKnock(ctx, e, { x: (e.x - x) / (d || 1), y: (e.y - y) / (d || 1) }, C.M(strong ? 20 : 15));
  }
  // ...and the one it struck is driven on, into whatever is behind it
  if (struck && struck.hp > 0) {
    const dv = dist(p.vx, p.vy) || 1;
    applyKnock(ctx, struck, { x: p.vx / dv, y: p.vy / dv }, C.M(strong ? 30 : 24));
    struck.impact = { dmg: strong ? 4 : 3, through: owner.mods.ramThrough };
  }
}

/** Chain Lightning: arc from a struck enemy through up to N nearby ones.
 * Hop range grows with chain count, zaps hit harder at tier II, and the
 * bolts render staggered so the chain reads e-e-e-e, not one flash. */
export function chainFrom(ctx: CombatHost, by: Player, victim: Enemy, now: number, count = by.mods.chain) {
  let n = count;
  const range = C.M(4 + by.mods.chain * 1.2);
  const zapDmg = by.mods.zapStun > 0 ? 2 : 1;
  const hit = new Set([victim.id]);
  let src = victim;
  let hop = 0;
  while (n-- > 0) {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of ctx.st.enemies) {
      if (e.hp <= 0 || hit.has(e.id) || now < e.zapCdUntil) continue;
      const same =
        (e.frame.kind === 'world' && src.frame.kind === 'world') ||
        (e.frame.kind === 'aboard' && src.frame.kind === 'aboard' && e.frame.ti === src.frame.ti);
      if (!same) continue;
      const d = dist(e.x - src.x, e.y - src.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) break;
    const [x0, y0] = [src.x, drawY(ctx, src)];
    const [x1, y1] = [best.x, drawY(ctx, best)];
    // The kinks are rolled HERE, in step order. They used to be rolled inside
    // a delayedCall, which drew from the run's random stream on Phaser's clock
    // rather than the simulation's, so how many numbers a client consumed
    // depended on its frame rate, and four clients in lockstep would have
    // drifted apart over a single chain (§11c).
    const k1x = x0 + (x1 - x0) * 0.35 + (ctx.run.rng() - 0.5) * 14;
    const k1y = y0 + (y1 - y0) * 0.35 + (ctx.run.rng() - 0.5) * 14;
    const k2x = x0 + (x1 - x0) * 0.7 + (ctx.run.rng() - 0.5) * 14;
    const k2y = y0 + (y1 - y0) * 0.7 + (ctx.run.rng() - 0.5) * 14;
    pushFx(ctx.run.fx, {
      kind: 'chain',
      points: [x0, y0, k1x, k1y, k2x, k2y, x1, y1],
      color: 0xaef0ff,
      delay: hop * 55,
    });
    pushFx(ctx.run.fx, ring(x1, y1, 5, 0xd8f8ff, 2, 160, 0.9, 6.45));
    hit.add(best.id);
    // freshly-zapped flesh will not carry the next arc for a beat: chain II
    // could stun-lock whole waves by re-arcing every bolt (from play: station
    // six cleared by shooting at an empty screen)
    best.zapCdUntil = now + 900;
    hurtEnemy(ctx, best, zapDmg, now, by);
    chargeHit(ctx, best, by, zapDmg, now);
    if (by.mods.zapStun > 0) best.stunUntil = Math.max(best.stunUntil, now + by.mods.zapStun);
    src = best;
    hop += 1;
  }
}

export function distToSeg(
  ctx: CombatHost,
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return dist(px - (x0 + t * dx), py - (y0 + t * dy));
}
