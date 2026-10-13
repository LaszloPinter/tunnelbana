import * as C from '../config.ts';
import { drawY } from './drawAt.ts';
import { applyKnock } from './enemies.ts';
import { hurtEnemy } from './enemyDeath.ts';
import { pushFx, ring, shake } from './fx.ts';
import type { Player } from '../sim/player.ts';
import { dist } from '../sim/det.ts';
import type { CombatHost, Enemy } from './types.ts';

/**
 * LADDNING (the charge lane, core/lanes.ts; replaced Studs 2026-09-22).
 *
 * Every hit puts a CHARGE on the body it hits, a bolt, each body a pierce
 * passes, every zap of a chain, a ram's slug three at once. At three the
 * body DETONATES: it and everything within two metres takes a blast, is
 * thrown back, and the neighbours are charged by it, so a pack is a fuse.
 * A body that dies with charges on it, or to a single hit, POPS: no blast,
 * but its charges go to the neighbours, which is what keeps the lane alive
 * on the first stations where everything dies in one hit. Charges fade
 * after a few seconds of not being hit. A state per body, so a torrent
 * charges no faster than it hits (the user's rule: rate-proof).
 *
 * Tier II reaches three metres, throws harder, and puts two charges on
 * each neighbour instead of one, so the fuse runs the whole pack.
 *
 * THE CAPS, measured (scripts/balance.ts, 2026-09-23): unbounded, a packed
 * eight went off in a self-feeding cascade every tick, 2700× the bare
 * bolt, because each blast charged seven neighbours which blew and
 * charged each other. So: a body takes at most one charge per quarter
 * second from ANY source (a torrent charges no faster than a bolt), is
 * locked for most of a second after it goes off, and is hurt by at most
 * one blast per quarter second, one wave of detonations is one blast
 * each, not seven.
 */

export const CHARGES_TO_BLOW = 3;
const CHARGE_TTL_MS = 4000;
/** the least between two charges on one body, whoever lands them */
const CHARGE_GAP_MS = 300;
/** a body that went off cannot be charged again for this long */
const LOCK_MS = 1000;
/** ...and one blast a body per this long, whatever is going off round it */
const BLAST_GAP_MS = 250;
/** a cascade may run this deep in one tick; past it the charges just sit */
const MAX_DEPTH = 6;

const sameFrame = (a: Enemy, b: Enemy): boolean =>
  (a.frame.kind === 'world' && b.frame.kind === 'world') ||
  (a.frame.kind === 'aboard' && b.frame.kind === 'aboard' && a.frame.ti === b.frame.ti);

function neighbours(ctx: CombatHost, e: Enemy, radius: number): Enemy[] {
  const out: Enemy[] = [];
  for (const o of ctx.st.enemies) {
    if (o === e || o.hp <= 0 || !sameFrame(o, e)) continue;
    if (dist(o.x - e.x, o.y - e.y) <= radius + o.r) out.push(o);
  }
  return out;
}

/** a hit landed on this body: charge it, and blow it if that was the third */
export function chargeHit(ctx: CombatHost, e: Enemy, by: Player | null, hitDmg: number, now: number, n = 1) {
  if (!by || by.mods.laddning <= 0) return;
  if (e.hp <= 0) {
    pop(ctx, e, by, now, 0);
    return;
  }
  addCharge(ctx, e, by, hitDmg, now, n, 0);
}

function addCharge(
  ctx: CombatHost,
  e: Enemy,
  by: Player,
  hitDmg: number,
  now: number,
  n: number,
  depth: number,
) {
  if (now < e.chargeLockUntil) return;
  if (now > e.chargeAt + CHARGE_TTL_MS) e.charge = 0;
  if (e.charge > 0 && now - e.chargeAt < CHARGE_GAP_MS) return;
  e.charge += n;
  e.chargeAt = now;
  if (e.charge >= CHARGES_TO_BLOW) {
    if (depth < MAX_DEPTH) detonate(ctx, e, by, hitDmg, now, depth);
    return;
  }
  pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), e.r * 1.1, 0xffb61e, 1.5, 160, 0.5, 6.4));
}

/** a charged body died (or died to one hit): its charges go to the neighbours */
function pop(ctx: CombatHost, e: Enemy, by: Player, now: number, depth: number) {
  const spread = by.mods.laddning >= 2 ? 2 : 1;
  const R = C.M(2);
  e.charge = 0;
  pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), e.r, 0xffd070, 2.2, 220, 0.6, 6.4));
  if (depth >= MAX_DEPTH) return;
  for (const o of neighbours(ctx, e, R)) addCharge(ctx, o, by, 1, now, spread, depth + 1);
}

/** the third charge: the body and everything round it takes the blast */
function detonate(ctx: CombatHost, e: Enemy, by: Player, hitDmg: number, now: number, depth: number) {
  const strong = by.mods.laddning >= 2;
  const R = C.M(strong ? 3 : 2);
  // tuned on scripts/balance.ts: ×2.5 lands tier I beside Lightning and Dark
  // with the torrent, ×3.5 keeps tier II a step above
  const dmg = Math.max(2, hitDmg * (strong ? 3.5 : 2.5)) * by.mods.blastMul;
  const spread = strong ? 2 : 1;
  e.charge = 0;
  e.chargeAt = 0;
  e.chargeLockUntil = now + LOCK_MS;
  const dy = drawY(ctx, e);
  pushFx(ctx.run.fx, ring(e.x, dy, R * 0.35, 0xffffff, 1 / 0.35, 240, 0.9, 6.45));
  pushFx(ctx.run.fx, ring(e.x, dy, R * 0.5, 0xffb61e, 1 / 0.5, 380, 0.7, 6.4));
  if (by.id === ctx.run.localId) pushFx(ctx.run.fx, shake(120, strong ? 0.005 : 0.0035));
  const near = neighbours(ctx, e, R);
  hurtEnemy(ctx, e, dmg, now, by);
  for (const o of near) {
    // one blast per body per wave: eight going off together is one hit
    // each, not seven
    if (now - o.blastAt < BLAST_GAP_MS) continue;
    o.blastAt = now;
    hurtEnemy(ctx, o, dmg, now, by);
    const d = dist(o.x - e.x, o.y - e.y) || 1;
    if (o.hp > 0) {
      applyKnock(ctx, o, { x: (o.x - e.x) / d, y: (o.y - e.y) / d }, C.M(strong ? 14 : 10));
      addCharge(ctx, o, by, hitDmg, now, spread, depth + 1);
    } else if (depth < MAX_DEPTH) pop(ctx, o, by, now, depth + 1);
  }
}
