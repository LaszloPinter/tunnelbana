import * as C from '../config.ts';
import { ORB_BASE } from '../core/perks.ts';
import { drawY } from './drawAt.ts';
import { pushFx, ring } from './fx.ts';
import { addStain } from './hazards.ts';
import { dist } from '../sim/det.ts';
import { manaMax, maxHp, nearestPlayer, xpToNext, type Player } from '../sim/player.ts';
import { LANE_EVERY } from '../core/lanes.ts';
import { HP_PER_LEVEL, rideXpMul, easeOf } from '../sim/chain.ts';
import { chainFrom } from './laneBolts.ts';
import { paxCheer, paxSaved } from './paxTalk.ts';
import { ticketCount } from '../core/cards.ts';
import { ENEMY_COLORS, type CombatHost, type Enemy, type Loot } from './types.ts';

/**
 * What it costs to hurt an enemy, who gets the credit, and what it leaves
 * behind when it dies: xp for the party, coins and lost property for the
 * floor, and the riders the killer's tickets carry.
 */

/**
 * Who gets the credit for a kill nobody cast: a train, a strike, a burn
 * still ticking. The nearest living player, which in single player is the
 * player, so the xp economy is exactly what it was.
 */
export function creditFor(ctx: CombatHost, e: Enemy): Player | null {
  return nearestPlayer(ctx.players, e.x, e.y);
}

/**
 * The party gains xp, and when it levels, EVERY seat gets a pick, the same
 * pick at the same moment, which is what makes a class moment a party event.
 */
export function gainXp(ctx: CombatHost, n: number) {
  const party = ctx.run.party;
  // later rides pay more (sim/chain.ts): the build keeps pace with the horde
  // the tutorial's dummies teach the casts, not the level-up
  // ...and the gentle start pays more a kill, for its fewer kills (chain.ts easeOf)
  if (!ctx.run.tutorial) party.xp += Math.round((n * rideXpMul(ctx.run.ride)) / easeOf(ctx.run));
  while (party.xp >= party.xpNext) {
    party.xp -= party.xpNext;
    party.level += 1;
    party.xpNext = xpToNext(party.level, ctx.run.players.length);
    for (const p of ctx.run.players) {
      if (!p.alive) continue;
      // a level is a little more body, whatever you pick (sim/chain.ts)
      p.maxHealth += HP_PER_LEVEL;
      p.health += HP_PER_LEVEL;
      // EVERY SIXTH LEVEL IS A LANE MOMENT, with no cap (the user's call,
      // 2026-09-22): the chain scales far enough that a party can hold every
      // lane at both tiers by the end of a long night. The rest are perks.
      if (party.level % LANE_EVERY === 0) p.pendingElement += 1;
      else p.pendingLevels += 1;
    }
  }
}

/** damage from `by`, or from the world (`null`), a train, a tunnel light */
export function hurtEnemy(
  ctx: CombatHost,
  e: Enemy,
  n: number,
  now: number,
  by: Player | null,
  /** a passenger's blow (DESIGN §20): 'helped' is the party's xp but nobody's
   * kill; 'unearned' is nobody's anything, a fight the party is not at */
  credit: 'auto' | 'helped' | 'unearned' = 'auto',
) {
  e.hp -= n;
  e.aggro = true;
  addStain(
    ctx,
    e.frame.kind === 'aboard' ? 'train' : 'world',
    e.frame.kind === 'aboard' ? e.frame.ti : 0,
    e.frame.kind === 'aboard' ? e.frame.rx : e.x,
    e.y + (ctx.run.rng() - 0.5) * 6,
    ENEMY_COLORS[e.type].stain,
    3 + ctx.run.rng() * 3,
    now,
  );
  if (e.hp <= 0) killEnemy(ctx, e, now, by, credit === 'unearned', credit === 'helped');
}

/**
 * A DEATH NOBODY EARNED: run over by a train, dropped down a shaft, caught by
 * one of the tunnel's own hazards. It is not a kill and it is not experience.
 *
 * `killEnemy` with no killer means "somebody here did this, work out who",
 * an impact debt, a ram, a chain, so it credits the nearest seat. That is
 * right for those and quite wrong for this: on the map the horde walks over a
 * platform edge whenever it feels like it, and a station's worth of vättar
 * wandering under the trains was paying the party a level every few seconds,
 * off screen, for nothing (from play 2026-09-11).
 */
export function killedByTheWorld(ctx: CombatHost, e: Enemy, now: number) {
  killEnemy(ctx, e, now, null, true);
}

export function killEnemy(
  ctx: CombatHost,
  e: Enemy,
  now: number,
  by: Player | null,
  /** the world did it: no kill, no xp, nobody to thank */
  unearned = false,
  /** a passenger did it: xp for the party, but no seat's kill and no ticket rides on it */
  helped = false,
) {
  e.hp = 0;
  const killer = unearned || helped ? null : (by ?? creditFor(ctx, e));
  if (killer) {
    killer.kills += 1;
    // a passenger it was biting says thank you (combat/paxTalk.ts)
    if (!helped) {
      paxSaved(ctx, e, killer, now);
      paxCheer(ctx, e, now);
    }
    // THE TICKETS that ride on a kill (core/cards.ts)
    if (killer) {
      const heal = ticketCount(killer, 'blodsugare');
      if (heal > 0) killer.health = Math.min(maxHp(killer), killer.health + 2 * heal);
      const sip = ticketCount(killer, 'manasugare');
      if (sip > 0) killer.mana = Math.min(manaMax(ctx.run.party, killer), killer.mana + 4 * sip);
      const arcs = ticketCount(killer, 'kedjebrev');
      if (arcs > 0) chainFrom(ctx, killer, e, now, arcs);
      const spread = ticketCount(killer, 'smittspridare');
      if (spread > 0) {
        const burst = Math.max(1, Math.round(e.maxHp * 0.3 * spread));
        pushFx(ctx.run.fx, ring(e.x, drawY(ctx, e), C.M(2), 0xd0ffb0, 3, 260, 0.7, 6.2));
        for (const o of ctx.st.enemies) {
          if (o === e || o.hp <= 0 || o.frame.kind !== e.frame.kind) continue;
          if (dist(o.x - e.x, o.y - e.y) < C.M(2) + o.r) hurtEnemy(ctx, o, burst, now, killer);
        }
      }
    }
  }
  // xp is the PARTY's (§16): the pool, not the killer, and there is none
  // for a death the party had no hand in
  if (!unearned) gainXp(ctx, 1 + (e.type === 'troll' ? 4 : e.type === 'spider' ? 3 : 0));
  // the poof is played by EnemyView when this id stops appearing
  const fr = e.frame;
  const frameKind = fr.kind === 'aboard' ? ('train' as const) : ('world' as const);
  const frameTi = fr.kind === 'aboard' ? fr.ti : 0;
  const aboard = fr.kind === 'aboard';
  const jid = aboard ? (fr.jid ?? ctx.st.rails[fr.ti]?.journey ?? undefined) : undefined;
  const onMap = aboard && !!jid;
  const lx = aboard ? fr.rx : e.x;
  // on the map a drop aboard is a SEAT, across the car and along it; in the
  // old world it was the car's x and the room's y
  const ly = !aboard ? e.y : onMap ? fr.ry : ctx.st.rails[fr.ti].train.centerY + fr.ry;
  // WHAT THIS ONE CARRIES is the seed's, not the path's: an enemy id names
  // an enemy that the seed itself put here (waves.ts), so the same kill in
  // two runs of a seed pays the same (from play 2026-09-04)
  const drop = ctx.run.contentRng(`loot:${e.id}`);
  // a mana orb, now and then, and oftener for the mana-orb perk, which
  // tops out at three picks (core/perks.ts)
  if (drop() < ORB_BASE + (killer ? killer.mods.orbChance : 0)) {
    ctx.st.pickups.push({
      id: ctx.run.nextLootId++,
      frame: frameKind,
      ti: frameTi,
      jid: onMap ? jid : undefined,
      x: lx,
      y: ly,
      expireAt: now + 30_000,
      color: 0x4fa8f0,
      r: 4,
    });
  }
  // the extra-coin chance: the tickets' share and the perk's (capped) share
  const luck = killer ? killer.mods.coinChance + killer.mods.coinLuck : 0;
  let drops = 1 + (drop() < Math.min(0.95, 0.4 + luck) ? 1 : 0);
  if (luck > 0.6 && drop() < luck - 0.6) drops += 1;
  if (e.type === 'troll') drops += 6;
  if (e.type === 'spider') drops += 4;
  if (e.type === 'boss') {
    // THE KING FALLS: a flat 1000 kr into every wallet (income is shared,
    // §16), a scatter of coins for the floor, the crown counted toward the
    // run's score, and THE BLACK CARD (core/cards.ts), which holds what a
    // yellow one holds and is not sold anywhere. Nothing here says what it
    // is for; that is the point of it (the user's call, 2026-09-06).
    drops += 8;
    ctx.run.bossKills += 1;
    for (const q of ctx.run.players) {
      if (!q.alive) continue;
      q.money += 1000;
      // ...and the tickets already loaded stay loaded: a black card is the
      // same three slots, so nothing has to be dropped to take it
      if (q.cardTier !== 'black') q.cardTier = 'black';
    }
    ctx.showMsg('BERGAKUNGEN FALLS: 1000 kr, and a card that is not for sale.', now);
  }
  for (let i = 0; i < drops; i++) {
    const jx = (drop() - 0.5) * C.M(1);
    const jy = (drop() - 0.5) * C.M(1);
    // a littered floor consolidates: top up the nearest pile instead of
    // adding another object for Phaser to transform every frame
    if (ctx.st.coins.length > 40) {
      let best: Loot | null = null;
      let bd = C.M(4);
      for (const c of ctx.st.coins) {
        if (c.frame !== frameKind || c.ti !== frameTi) continue;
        const d = dist(c.x - (lx + jx), c.y - (ly + jy));
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) {
        best.value = (best.value ?? 5) + 5;
        best.r = Math.min(6.5, best.r + 0.35);
        best.expireAt = Math.max(best.expireAt, now + 25_000);
        continue;
      }
    }
    ctx.st.coins.push({
      id: ctx.run.nextLootId++,
      frame: frameKind,
      ti: frameTi,
      jid: onMap ? jid : undefined,
      under: !aboard && ctx.run.map.at(lx + jx, ly + jy)?.kind === 'bed',
      x: lx + jx,
      y: ly + jy,
      // LONG ENOUGH TO WALK TO: with passengers fighting all over a platform
      // the coins fall far from you, and 25 s was gone before you got there
      // (from play 2026-10-10)
      expireAt: now + 90_000,
      color: 0xf5c542,
      r: 3.5,
    });
  }
}

/** the living enemy nearest a world point (for homing locks) */
export function nearestEnemyTo(ctx: CombatHost, wx: number, wy: number, excludeId = -1): number | undefined {
  let best: number | undefined;
  let bd = Infinity;
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0 || e.id === excludeId) continue;
    const d = dist(e.x - wx, e.y - wy);
    if (d < bd) {
      bd = d;
      best = e.id;
    }
  }
  return best;
}
