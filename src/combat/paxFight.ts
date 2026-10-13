import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { manaMax, maxHp } from '../sim/player.ts';
import { PAX_KINDS, sayLine, type Passenger } from '../sim/passenger.ts';
import type { Run } from '../sim/run.ts';
import { applyKnock } from './enemies.ts';
import { hurtEnemy } from './enemyDeath.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost, Enemy } from './types.ts';

/**
 * WHAT PASSENGERS CAN DO TO THE HORDE, AND FOR EACH OTHER (DESIGN §20): a
 * blow, a thrown smällare, a nurse's pulse. Every kill they make is the
 * party's xp but nobody's kill, and only where the party stands (a fight
 * at the next station over must not level you off screen).
 */
const credit = (ctx: CombatHost) => (ctx.players.length > 0 ? 'helped' : 'unearned') as 'helped' | 'unearned';

/** a word as they act, now and then, not every blow */
function shout(ctx: CombatHost, ps: Passenger, now: number) {
  if (now - ps.sayAt > 9_000) sayLine(ctx.run as unknown as Run, ps, 'act', now);
}

/** a blow at something in reach, with their weight behind it */
export function strike(ctx: CombatHost, ps: Passenger, foe: Enemy, now: number) {
  const k = PAX_KINDS[ps.kind];
  if (now < ps.cdUntil) return;
  ps.cdUntil = now + k.cdMs;
  ps.swingAt = now;
  const d = dist(foe.x - ps.x, foe.y - ps.y) || 1;
  applyKnock(ctx, foe, { x: (foe.x - ps.x) / d, y: (foe.y - ps.y) / d }, k.knock);
  if (k.role === 'melee') shout(ctx, ps, now);
  hurtEnemy(ctx, foe, k.dmg, now, null, credit(ctx));
}

/** a smällare, thrown: a real projectile, flagged as a passenger's (projectiles.ts) */
export function throwAt(ctx: CombatHost, ps: Passenger, foe: Enemy, now: number) {
  const k = PAX_KINDS[ps.kind];
  if (now < ps.cdUntil) return;
  ps.cdUntil = now + k.cdMs;
  ps.swingAt = now;
  const d = dist(foe.x - ps.x, foe.y - ps.y) || 1;
  const speed = C.PISTOL_SPEED * 0.55;
  ctx.st.projs.push({
    id: ctx.run.nextProjId++,
    frame: 'world',
    ti: 0,
    x: ps.x,
    y: ps.y,
    vx: ((foe.x - ps.x) / d) * speed,
    vy: ((foe.y - ps.y) / d) * speed,
    friendly: true,
    owner: -1,
    pax: true,
    dieAt: now + Math.round((k.reach / speed) * 1000) + 150,
    dmg: k.dmg,
    pierce: 0,
    lastHit: -1,
    bounces: 0,
    color: 0xffb347,
    isSplit: false,
  });
  shout(ctx, ps, now);
}

/**
 * THE NURSE'S PULSE: when anyone near her is hurt, everyone within reach,
 * passengers and seats alike, is patched up a little, and she says so.
 */
export function tryHeal(ctx: CombatHost, ps: Passenger, now: number): boolean {
  const k = PAX_KINDS[ps.kind];
  if (now < ps.cdUntil) return false;
  const run = ctx.run as unknown as Run;
  const near = (x: number, y: number) => dist(x - ps.x, y - ps.y) < k.reach;
  const hurtPax = run.pax.filter(
    (q) => q.alive && q.mode === 'foot' && q.placeId === ps.placeId && near(q.x, q.y) && q.hp < q.maxHp * 0.7,
  );
  const hurtSeats = ctx.players.filter((p) => p.alive && near(p.x, p.y) && p.health < maxHp(p) * 0.7);
  if (hurtPax.length === 0 && hurtSeats.length === 0) return false;
  ps.cdUntil = now + k.cdMs;
  ps.swingAt = now;
  for (const q of hurtPax) q.hp = Math.min(q.maxHp, q.hp + k.dmg);
  for (const p of hurtSeats) {
    p.health = Math.min(maxHp(p), p.health + Math.round(k.dmg * 0.5));
    p.mana = Math.min(manaMax(run.party, p), p.mana + 6);
  }
  pushFx(run.fx, ring(ps.x, ps.y, k.reach * 0.6, 0x8ef0a8, 1.7, 520, 0.45, 6.3));
  shout(ctx, ps, now);
  return true;
}
