import * as C from '../config.ts';
import { drawYAt } from '../sim/legView.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { spawnEnemy } from './enemies.ts';
import { killedByTheWorld } from './enemyDeath.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost } from './types.ts';
import { dist } from '../sim/det.ts';

/**
 * The things on the floor that hurt: acid pools, the telegraphed tunnel-light
 * strikes that sweep a riding car, and the stains everything leaves behind.
 * All of them carry a frame so they ride along with a moving train.
 */

export function addStain(
  ctx: CombatHost,
  frame: 'world' | 'train',
  ti: number,
  x: number,
  y: number,
  color: number,
  r: number,
  now: number,
  /** aboard, and on the map: x and y are a seat on this journey */
  jid?: string,
) {
  // the oldest stain simply falls off the end of the list; GroundView reaps
  // the picture on the next frame because its id is gone
  if (ctx.st.stains.length >= 100) ctx.st.stains.shift();
  ctx.st.stains.push({ id: ctx.run.nextLootId++, frame, ti, jid, x, y, expireAt: now + 25_000, color, r });
}

/**
 * THE TRAIN A WARNING IS ABOUT, and whether it is still here.
 *
 * A warning is pinned to a rail SLOT, and a slot is reassigned the moment its
 * train pulls out (core/world.ts Rail). One that outlives a departure follows
 * whatever draws in next: a window scrabbled at, or a tunnel light swept,
 * across a train nobody is riding. Naming the journey settles it, and it is
 * also what turns the warning's place in the car into a place on the map.
 */
function onThisTrain(ctx: CombatHost, ti: number, jid: string | undefined) {
  const rail = ctx.st.rails[ti];
  if (!rail) return null;
  if (jid && rail.journey !== jid) return null;
  return rail.train;
}

/** ...and where in the world that place in the car actually is */
function warnAt(
  ctx: CombatHost,
  jid: string | undefined,
  rx: number,
  ry: number,
  t: { x: number; centerY: number },
  ti: number,
) {
  const seat = jid ? aboardPoint(jid, rx, ry, ctx.run.gameNow) : null;
  if (seat) return seat;
  const cx = t.x + rx;
  return { x: cx, y: drawYAt(ctx.st, cx, t.centerY + ry, ti) };
}

/** telegraph brightens, then the light hits: player takes heavy damage
 * unless dashing/clear; aboard enemies in the zone are simply obliterated */
/**
 * The moment before a crawl-in: something at the window, working its way
 * through. It rides with the car, so it stays on the spot it will actually
 * come in at, and it is worth shooting at, a boarding cut short never
 * becomes an enemy.
 */
export function stepBoardings(ctx: CombatHost, now: number) {
  ctx.st.boardings = ctx.st.boardings.filter((b) => {
    const t = onThisTrain(ctx, b.ti, b.jid);
    if (!t) return false;
    const at = warnAt(ctx, b.jid, b.rx, b.ry, t, b.ti);
    const cx = at.x;
    const cy = at.y;
    if (now < b.at) {
      // put a shot through the window it is working at and it never gets in.
      // That is what the warning is FOR: somewhere to aim from the end of the
      // car you are holding
      const shot = ctx.st.projs.find((pr) => {
        if (!pr.friendly) return false;
        // ON THE MAP a bolt is a thing in the world like the window it is
        // aimed at (combat/casting.ts), so the two are compared where they are
        if (b.jid && pr.frame === 'world') return dist(pr.x - cx, pr.y - cy) < C.M(1.1);
        const rx = pr.x - t.x;
        return Math.abs(rx - b.rx) < C.M(1.1) && Math.abs(pr.y - (t.centerY + b.ry)) < C.M(0.8);
      });
      if (shot) {
        shot.dieAt = now - 1;
        pushFx(ctx.run.fx, ring(cx, cy, C.M(0.9), 0xffd9a0, 1.5, 220, 1, 6.5));
        return false;
      }
      // how far along the scrabbling is, is BoardingView's to draw
      return true;
    }
    spawnEnemy(ctx, b.type, { kind: 'aboard', ti: b.ti, rx: b.rx, ry: b.ry, jid: b.jid }, cx, cy, true);
    return false;
  });
}

export function stepStrikes(ctx: CombatHost, now: number) {
  ctx.st.strikes = ctx.st.strikes.filter((s) => {
    const t = onThisTrain(ctx, s.ti, s.jid);
    if (!t) return false;
    const at = warnAt(ctx, s.jid, (s.x0 + s.x1) / 2, 0, t, s.ti);
    const cx = at.x;
    const cy = at.y;
    // the telegraph itself, amber flooding in, the border hardening, the
    // warning throbbing, is StrikeView's; this decides only when it lands
    if (now < s.at) return true;
    // impact
    pushFx(ctx.run.fx, ring(cx, cy, (s.x1 - s.x0) / 2, 0xffffff, 1.25, 320, 0.9, 6.6));
    addStain(ctx, 'train', s.ti, (s.x0 + s.x1) / 2, s.jid ? 0 : t.centerY, 0x201408, 9, now, s.jid);
    pushFx(ctx.run.fx, { kind: 'shake', ms: 220, power: 0.007 });
    for (const p of ctx.players) {
      const f = p.frame;
      if (
        p.alive &&
        !p.downed &&
        f.kind !== 'world' &&
        f.ti === s.ti &&
        f.rx > s.x0 - p.r &&
        f.rx < s.x1 + p.r
      ) {
        ctx.run.hurt(p, 30, 'The tunnel light burned you. Dash to shadow!', now);
      }
    }
    for (const e of ctx.st.enemies) {
      if (e.hp <= 0 || e.frame.kind !== 'aboard' || e.frame.ti !== s.ti) continue;
      if (e.frame.rx > s.x0 - e.r && e.frame.rx < s.x1 + e.r) killedByTheWorld(ctx, e, now);
    }
    return false;
  });
}

export function spawnAcidPool(
  ctx: CombatHost,
  frame: 'world' | 'train',
  ti: number,
  x: number,
  y: number,
  now: number,
) {
  ctx.st.acidPools.push({
    id: ctx.run.nextLootId++,
    frame,
    ti,
    x,
    y,
    expireAt: now + 6500,
    color: 0x6a9a2a,
    r: C.M(1.25),
  });
}

export function stepAcidPools(ctx: CombatHost, now: number) {
  ctx.st.acidPools = ctx.st.acidPools.filter((pool) => {
    if (now > pool.expireAt) return false;
    const wx = pool.frame === 'train' ? ctx.st.rails[pool.ti].train.x + pool.x : pool.x;
    for (const p of ctx.players) {
      if (!p.alive || p.downed) continue;
      // on the map a pool and a rider are both points in Stockholm, whatever
      // the rider is standing in; asking for the same frame let a rider
      // stand in acid spat into a doorway and never burn
      const sameFrame = pool.frame === 'world' || (p.frame.kind !== 'world' && p.frame.ti === pool.ti);
      if (sameFrame && dist(p.x - wx, p.y - pool.y) < C.M(1.25)) {
        ctx.run.hurt(p, 6, 'Acid burns underfoot!', now);
      }
    }
    return true;
  });
}

export function stepStains(ctx: CombatHost, now: number) {
  // nothing to move: a stain's position is its frame's, and GroundView reads
  // that when it draws. All the simulation does is let them expire.
  ctx.st.stains = ctx.st.stains.filter((s) => now <= s.expireAt);
}
