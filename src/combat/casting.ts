import * as C from '../config.ts';
import { boostActive } from '../core/bag.ts';
import { drawY } from './drawAt.ts';
import { LANE_INFO } from '../core/lanes.ts';
import { nearestEnemyTo } from './enemyDeath.ts';
import { BTN } from '../sim/tick.ts';
import { ticketCount } from '../core/cards.ts';
import { datan2, dcos, dist, dsin, lerp } from '../sim/det.ts';
import { hurtEnemy } from './enemyDeath.ts';
import { applyKnock, sameFrame } from './enemies.ts';
import { pushFx, ring } from './fx.ts';
import type { CombatHost } from './types.ts';
import { activePlayers, aimWorld, manaMax, maxHp, type Player } from '../sim/player.ts';
import { seatDrift } from '../world/trainSeat.ts';

/** one player's own casting: regen, the passives, the trigger, STÖT */
export function stepPlayerCombat(ctx: CombatHost, p: Player, dt: number, now: number) {
  const m = p.mods;
  // mana trickles back slowly; buying is still the real supply line.
  if (now >= p.nextManaAt) {
    p.nextManaAt = now + C.MANA_REGEN_MS / m.manaRegen;
    if (p.mana < manaMax(ctx.run.party, p)) p.mana += 1;
  }

  // the classes' passives (core/classes.ts)
  if (m.hpRegen > 0 && p.health < maxHp(p)) p.health = Math.min(maxHp(p), p.health + m.hpRegen * dt);
  if (m.regenAura > 0) {
    for (const q of activePlayers(ctx.players)) {
      if (q === p || q.health >= maxHp(q) || q.frame.kind !== p.frame.kind) continue;
      if (dist(q.x - p.x, q.y - p.y) < C.M(5)) q.health = Math.min(maxHp(q), q.health + m.regenAura * dt);
    }
  }
  const aim = aimWorld(p, (x, y) => drawY(ctx, p, x, y));
  // Rusning: standing still, the casts come faster
  const still = p.input.mx === 0 && p.input.my === 0 ? 1 / 1.4 ** ticketCount(p, 'rusning') : 1;
  // Langaren's 'Kaffe, starkt' (core/bag.ts): casts come faster while it lasts
  const brew = boostActive(p, 'cast', now) ? 1 / 1.5 : 1;
  stepNova(ctx, p, now);
  // a tap on a card is not a cast (from play: every pick fired a shot)
  if (p.input.held & BTN.fire && now > p.fireCdUntil && !p.offer) {
    // rate floors: stacked cast-speed perks approach a limit instead of
    // reaching mana-evaporating absurdity. Bolt hits for 2 base vs the
    // torrent's 1: heavy precise shots vs a mana-hungry spray. The floors
    // are the PERKS'; a ticket's cast speed (m.ticketCast) goes under them.
    const weapon = p.weapon;
    if (weapon === 'pistol') {
      // the dart's bolt: slow, heavy, fast, and it pierces, one thing at a time
      const heavy = m.heavyBolt > 0;
      fireGun(
        ctx,
        p,
        aim,
        now,
        Math.max(120, C.PISTOL_RATE_MS * m.pistolRate) * (heavy ? 2.2 : 1) * still * m.ticketCast * brew,
        C.PISTOL_SPEED * (heavy ? 1.3 : 1),
        C.PISTOL_TTL_MS,
        heavy ? 0.01 : 0.03,
        (2 + 2 * m.bulletDamage) * (heavy ? 3 : 1),
        heavy ? 3 : 2,
      );
    } else if (weapon === 'smg') {
      // spool-up: the longer you hold, the faster it spins, tighter it groups
      const heat = p.torrentHeat;
      const tRate = lerp(150 * m.smgRate, Math.max(40, 55 * m.smgRate), heat) * still * m.ticketCast * brew;
      // A SPRAY, NOT A NARROWER BOLT: a wide cone that tightens a little
      // as it spins up, and every pellet shoves (from play 2026-09-17:
      // "bolt and torrent are interchangeable")
      fireGun(
        ctx,
        p,
        aim,
        now,
        Math.max(40, tRate),
        C.SMG_SPEED,
        C.SMG_TTL_MS,
        0.7 - heat * 0.25,
        1 + m.bulletDamage,
        1,
      );
    }
  }
  // torrent heat winds down when the trigger rests
  if (!(p.input.held & BTN.fire && p.weapon === 'smg')) {
    p.torrentHeat = Math.max(0, p.torrentHeat - dt * 1.1);
  }
}

/**
 * STÖT: the shockwave. One press (RMB or Q), a mana cost, a cooldown,
 * everything around you takes a hit, is thrown back and stands stunned,
 * and an elite's ward in reach is shattered. It replaces the ward, which
 * nobody raised (from play 2026-09-17: "ward I never use, very boring").
 */
export function stepNova(ctx: CombatHost, p: Player, now: number) {
  if (!(p.input.pressed & (BTN.shield | BTN.ult))) return;
  if (now < p.nextNovaAt || p.offer) return;
  if (p.mana < C.NOVA_COST) {
    ctx.showMsg(`Out of mana: STÖT needs ${C.NOVA_COST}.`, now, p);
    return;
  }
  const m = p.mods;
  p.mana -= C.NOVA_COST;
  p.nextNovaAt = now + C.NOVA_CD_MS * m.novaCd;
  const R = C.NOVA_RADIUS * m.novaRadius;
  // Langaren's 'Nävar av sten' (core/bag.ts): STÖT hits harder while it lasts
  const fists = boostActive(p, 'stot', now) ? 1.8 : 1;
  const dmg = (8 + ctx.run.party.level) * m.novaPower * fists;
  const dy = drawY(ctx, p);
  pushFx(ctx.run.fx, ring(p.x, dy, R, 0xffffff, 4, 260, 0.6, 6.4));
  pushFx(ctx.run.fx, { kind: 'shake', ms: 160, power: 0.006 });
  ctx.showMsg('STÖT!', now, p);
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0 || !sameFrame(p, e)) continue;
    const d = dist(e.x - p.x, e.y - p.y);
    if (d > R) continue;
    if (e.ward) e.ward.hp = 0;
    applyKnock(
      ctx,
      e,
      { x: (e.x - p.x) / (d || 1), y: (e.y - p.y) / (d || 1) },
      C.NOVA_KNOCK * m.novaPower * fists,
    );
    e.stunUntil = now + C.NOVA_STUN_MS;
    hurtEnemy(ctx, e, dmg, now, p);
  }
}

export function playCast(p: Player, now: number, kind: 'arc' | 'bolt' | 'torrent') {
  if (kind === 'torrent') {
    p.castKind = 'hold';
    p.castHoldUntil = now + 240;
  } else {
    p.castKind = 'once';
    p.castStart = now;
  }
}

/** bolts wear your first waveclear lane's colour; arcane violet before any */
export function boltColor(p: Player): number {
  for (const id of p.laneOrder) {
    return LANE_INFO[id].color;
  }
  return 0xd9c8ff;
}

export function fireGun(
  ctx: CombatHost,
  p: Player,
  aim: { x: number; y: number },
  now: number,
  rateMs: number,
  speed: number,
  ttlMs: number,
  spread: number,
  dmg: number,
  cost: number,
) {
  if (p.mana < cost) {
    ctx.showMsg('Out of mana: the MANA machine, or wait for it to trickle back.', now, p);
    p.fireCdUntil = now + 400;
    return;
  }
  p.mana -= cost;
  if (p.weapon === 'smg') p.torrentHeat = Math.min(1, p.torrentHeat + 0.085);
  p.fireCdUntil = now + rateMs;
  playCast(p, now, p.weapon === 'smg' ? 'torrent' : 'bolt');
  // Twin Casts works for both the bolt and the torrent
  const shots = ctx.run.rng() < p.mods.doubleTap ? 2 : 1;
  // the homing lock is chosen nearest the cursor AS SAMPLED into this tick,
  // it used to read the live pointer, which is not something four clients share
  const homeTarget = p.mods.homing > 0 ? nearestEnemyTo(ctx, p.input.aimX, p.input.aimY) : undefined;
  // the ram lane: every Nth cast is a RAM, and the count is the cast's, not
  // the shot's, a twin cast is one heavy pair
  p.castCount += 1;
  const heavy = p.mods.ramEvery > 0 && p.castCount % p.mods.ramEvery === 0;
  for (let i = 0; i < shots; i++) {
    const ang =
      datan2(aim.y, aim.x) +
      (ctx.run.rng() - 0.5) * spread +
      (p.weapon === 'smg' ? (i - (shots - 1) / 2) * 0.2 : i * 0.07);
    const f = p.frame;
    // only INSIDE a car do bullets live in the train frame; from the joint
    // (between cars, outside) they fly free in the world like you do.
    //
    // ...AND ON THE MAP THERE IS NO TRAIN FRAME. A car's own x was a
    // distance from that train's left edge in the STATION's chart, and a
    // bolt given a world position minus a station-local one is a bolt
    // nowhere near anything: fired from a seat it flew off toward the map's
    // origin, invisible, and hit nothing (from play 2026-09-11: "I cannot
    // shoot / see my shot / damage enemies on the train"). Out here a bolt
    // is a thing in the world like the body that fired it, and it leaves
    // the muzzle with the car's own speed under it, which is what makes a
    // shot down a moving aisle land.
    const ti = f.kind === 'aboard' ? f.ti : 0;
    const carried = f.kind === 'aboard' && f.jid ? seatDrift(f.jid, f.rx, ctx.run.gameNow) : null;
    // the picture is the renderer's business now: ProjectileView makes one
    // for any id it has not seen and reaps it when the id is gone
    // a crit is rolled per shot, from the run's stream like everything else
    // this seat's Nth shot crits or it does not, by the seed, a crit is
    // content, not a reaction (from play 2026-09-04)
    const crit =
      p.mods.critChance > 0 && ctx.run.contentRng(`crit:${p.id}:${p.castCount}:${i}`)() < p.mods.critChance;
    const col = crit ? 0xffffff : boltColor(p);
    ctx.st.projs.push({
      frame: 'world',
      ti,
      jid: f.kind === 'aboard' ? f.jid : undefined,
      x: p.x,
      y: p.y,
      vx: dcos(ang) * speed * (heavy ? 0.75 : 1) + (carried?.vx ?? 0),
      vy: dsin(ang) * speed * (heavy ? 0.75 : 1) + (carried?.vy ?? 0),
      // the car's share of that, so distance flown is measured down the aisle
      dvx: carried?.vx ?? 0,
      dvy: carried?.vy ?? 0,
      flown: 0,
      friendly: true,
      owner: p.id,
      dieAt: now + ttlMs,
      dmg: (crit ? dmg * p.mods.critMul : dmg) * p.mods.boltMul * (heavy ? 1.5 : 1),
      pierce: p.mods.pierce,
      lastHit: -1,
      bounces: 0,
      color: heavy ? 0xffb070 : col,
      isSplit: false,
      targetId: homeTarget,
      heavy,
      torrent: p.weapon === 'smg',
      id: ctx.run.nextProjId++,
    });
  }
}

/** the world velocity of the car a caster is riding: a bolt fired inside it
 * carries that with it, the way everything loose in a moving train does */
