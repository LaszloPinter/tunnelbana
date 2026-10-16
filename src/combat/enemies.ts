import * as C from '../config.ts';
import { seatAt } from '../world/trainSeat.ts';
import { intoWorld } from '../world/floor.ts';
import { clearSpot } from '../world/walk2d.ts';
import type { Run } from '../sim/run.ts';
import type { EntityFrame } from '../core/world.ts';
import type { EnemyKind } from './types.ts';
import { rideHpMul, rideSmartChance, easeOf } from '../sim/chain.ts';
import { sameFrameAs, type Player } from '../sim/player.ts';
import { ENEMY_R, type Approach, type CombatHost, type Enemy, type Tempo, type Variant } from './types.ts';

/**
 * What an enemy IS: what spawns, what it costs to hurt, and what it leaves
 * behind when it dies. What it DOES, knockback, hunting, riding a car,
 * biting, is enemyAI.ts.
 *
 * Enemies live either on the station floor (world frame) or inside one car of
 * one train (aboard frame, coordinates relative to that train's left edge), so
 * a moving train carries its passengers without any of this code knowing.
 */

/** move an enemy to a world position, keeping its train-local coords honest */
export function placeEnemy(ctx: CombatHost, e: Enemy, x: number, y: number) {
  e.x = x;
  e.y = y;
  if (e.frame.kind !== 'aboard') return;
  // ON THE MAP the seat is asked of the train's own line: the room's
  // train.x against a point in Stockholm made a seat thousands of pixels
  // long, and the rider snapped to the end of the car
  const jid = e.frame.jid ?? ctx.st.rails[e.frame.ti]?.journey;
  if (jid) {
    const seat = seatAt(jid, ctx.run.gameNow, x, y);
    if (seat) {
      e.frame.rx = seat.rx;
      e.frame.ry = seat.ry;
      return;
    }
  }
  const t = ctx.st.rails[e.frame.ti].train;
  e.frame.rx = x - t.x;
  e.frame.ry = y - t.centerY;
}

/** on-hit riders shared by every damage source: the riders are the
 * HITTER's, so the hitter is named, not assumed */
export function applyOnHit(ctx: CombatHost, by: Player, e: Enemy, now: number) {
  if (e.hp <= 0) return;
  const m = by.mods;
  if (m.slowMs > 0) e.slowUntil = now + m.slowMs;
}

/** shove as velocity, not teleport, integrated (and decayed) every step */
export function applyKnock(ctx: CombatHost, e: Enemy, dir: { x: number; y: number }, power: number) {
  const mass =
    e.type === 'boss'
      ? 0.06
      : e.type === 'troll'
        ? 0.25
        : e.type === 'daemon'
          ? 0.3
          : e.variant === 'brute' || e.variant === 'stone'
            ? 0.5
            : 1; // a brute is heavy, a stone vätte heavier; a mountain more so
  e.kvx += dir.x * power * mass;
  e.kvy += dir.y * power * mass;
}

/** what crawls out this time: vermin joins the mix, spiders come late */
export function rollEnemyType(
  ctx: CombatHost,
  t: number,
  spitChance: number,
  rng: () => number = () => ctx.run.rng(),
): EnemyKind {
  const r = rng();
  const spiders = ctx.st.enemies.filter((e) => e.type === 'spider' && e.hp > 0).length;
  if (t > 120 && spiders < 1 && r < 0.07) return 'spider';
  // from the third stop, trolls walk with the waves, a levelled build needs
  // something it cannot delete by holding the trigger down
  if (ctx.run.stopsTraveled >= 3 && r < 0.04 + Math.min(0.08, ctx.run.stopsTraveled * 0.012)) return 'troll';
  if (r < spitChance) return 'spitter';
  return 'runner';
}

export function spawnEnemy(
  ctx: CombatHost,
  type: EnemyKind,
  frame: EntityFrame,
  x: number,
  y: number,
  aggro = true,
  hpBonus = 0,
  sizeMul = 1,
  /** the party's toughness scale (waves.ts): four players are more than four, so is the horde */
  hpMul = 1,
  /** the stream this one's build is rolled from: a wave's own, so what a
   * wave holds is a function of the seed (sim/det.ts seedOf) */
  rng: () => number = () => ctx.run.rng(),
  /** force the build instead of rolling it, the tunnel's own (Variant) */
  forceVariant?: Variant,
): Enemy {
  if (type === 'spider') sizeMul = 2.6;
  if (type === 'boss') sizeMul = 3.1;
  const t = (ctx.run.gameNow - ctx.run.runStart) / 1000;
  // DISTANCE hardens the horde as much as time (from play: by station six a
  // levelled build was clearing blind), and HP TRACKS THE PARTY'S LEVEL
  // (decided in chat 2026-08-25, option C): the pick is what damage scales
  // with, so it is what the horde scales against.
  const stops = ctx.run.stopsTraveled;
  const L = ctx.run.party.level;
  // ...and every ride of the chain much more so (sim/chain.ts)
  const ride = ctx.run.ride;
  const deep = (1 + 0.1 * stops) * rideHpMul(ride);
  const hpByType: Record<EnemyKind, number> = {
    // ...and gentler on the party's level than it was (0.35 and 0.3): the
    // bolt never kept pace with it (sim/chain.ts rideHpMul)
    runner: (2 + 0.25 * L) * deep,
    spitter: (2 + 0.2 * L) * deep,
    troll: (30 + 2 * L) * deep,
    spider: (40 + 3 * L) * deep,
    // the king scales with how deep into the night you meet him
    boss: (220 + 12 * L) * deep,
    // the mid-boss: a station's problem, not a wave's
    daemon: (80 + 6 * L) * deep,
  };
  // a vätte's build: a few in every wave are runts or brutes (size, pace, hp)
  const variant: Variant =
    forceVariant ??
    (type === 'runner'
      ? rng() < 0.16
        ? 'runt'
        : (t > 40 || stops >= 1 || ride >= 1) && rng() < 0.16 + 0.05 * ride
          ? 'brute'
          : (stops >= 1 || ride >= 1) && rng() < 0.08 + 0.07 * ride
            ? 'elite'
            : 'plain'
      : 'plain');
  // the smart share of the pack (combat/enemyPack.ts): none on the first ride
  const smart = type === 'runner' && ride >= 1 && rng() < rideSmartChance(ride);
  const varHp =
    variant === 'runt'
      ? 0.6
      : variant === 'brute'
        ? 2.4
        : variant === 'stone'
          ? 3
          : variant === 'elite'
            ? 2.2
            : 1;
  // softer on the first ride's first stops (sim/chain.ts easeOf)
  const ease = 0.6 + 0.4 * easeOf(ctx.run);
  const hp = Math.max(1, Math.round((hpByType[type] + hpBonus) * hpMul * varHp * ease));
  if (variant === 'runt') sizeMul = 0.78;
  if (variant === 'brute') sizeMul = 1.5;
  if (variant === 'stone') sizeMul = 1.2;
  if (variant === 'elite') sizeMul = 1.35;
  // a spawn point is named in the place's own terms; the WORLD stores where
  // a body is, so this is where the naming ends (src/world/floor.ts)
  if (frame.kind === 'world') {
    const named = intoWorld(ctx.st, x, y);
    // ...and onto ground it can stand on, WITHOUT moving it anywhere it was
    // not meant to be. A spawn point is a deliberate place in a station's
    // plan, the foot of an escalator, a scatter across the deck, and it
    // stays there: measured over a run's spawns, 74 of 75 are not moved at
    // all and the one that is moves half a metre, off furniture it would
    // otherwise have hatched inside.
    const here = clearSpot(ctx.run as unknown as Run, named.x, named.y, ENEMY_R);
    x = here.x;
    y = here.y;
  }
  const approach = rollApproach(ctx, type, rng);
  const approachSide: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const approachPhase = rng() * 6.283185307179586;
  // how wide the line goes / how far a spitter holds: no two alike
  const approachMag = type === 'spitter' ? C.M(5 + rng() * 4) : C.M(2.5 + rng() * 3.5);
  const tempo = rollTempo(ctx, type, variant, rng);
  // no two in a file walk at the same pace
  const paceJitter = 0.88 + rng() * 0.24;
  const varPace = variant === 'runt' ? 1.3 : variant === 'brute' ? 0.72 : variant === 'quick' ? 2 : 1;
  // the body as the shot sees it: ~31 px on the floor, so ENEMY_R (9 px) let
  // shots fly through the picture (from play); it grows with the build
  const rByType: Record<EnemyKind, number> = {
    runner: C.M(0.7) * sizeMul,
    spitter: C.M(0.75),
    troll: C.M(1.05),
    // the drawn spider spans ~6 m of legs; the body the shot sees is most of it (from play: hard to hit)
    spider: C.M(2.3),
    boss: C.M(1.9),
    daemon: C.M(1.4),
  };
  const e: Enemy = {
    steppedAt: -1,
    id: ctx.run.nextEnemyId++,
    type,
    r: rByType[type],
    frame,
    x,
    y,
    hp,
    maxHp: hp,
    speedMul:
      (1 + Math.min(0.55, t * 0.0012 + ctx.run.stopsTraveled * 0.025) + Math.min(0.2, 0.05 * ride)) *
      paceJitter *
      varPace *
      // slower on the first ride's first stops (sim/chain.ts easeOf)
      (0.75 + 0.25 * easeOf(ctx.run)),
    smart,
    dodgeAt: 0,
    slide: 0,
    charge: 0,
    chargeAt: 0,
    chargeLockUntil: 0,
    blastAt: 0,
    slowUntil: 0,
    aggro,
    kvx: 0,
    kvy: 0,
    wanderX: x,
    wanderY: y,
    nextWanderAt: 0,
    stunUntil: 0,
    onBedUntil: 0,
    hitCdUntil: 0,
    shootCdUntil: 0,
    acidAt: 0,
    spitAt: 0,
    slamAt: 0,
    marks: [],
    zapCdUntil: 0,
    leapAt: 0,
    leapX: 0,
    leapY: 0,
    leapCdUntil: 0,
    sizeMul,
    approach,
    approachSide,
    approachPhase,
    approachStage: 0,
    approachMag,
    approachAt: 0,
    approachLean: 0,
    tempo,
    tempoState: 0,
    tempoAt: 0,
    variant,
    ofTunnel: false,
  };
  // AN ELITE GOES IN FRONT, holding a ward toward you: what crowds behind it
  // is safe until the ward is broken. The king carries one too.
  if (variant === 'elite' || type === 'boss') {
    const max = Math.round(C.WARD_HP * (type === 'boss' ? 3 : 1) * (1 + stops * 0.15));
    e.ward = { hp: max, max, angle: 0 };
  }
  ctx.st.enemies.push(e);
  return e;
}

/** the rhythm (types.ts `Tempo`): brutes stalk, runts skitter, the rest mix */
export function rollTempo(
  ctx: CombatHost,
  type: EnemyKind,
  variant: Variant,
  rng: () => number = () => ctx.run.rng(),
): Tempo {
  // the cacodaemon IS the lunge: it only ever stalks
  if (type === 'daemon') return 'stalker';
  if (type !== 'runner' && type !== 'spider') return 'steady';
  const r = rng();
  if (variant === 'brute') return r < 0.7 ? 'stalker' : 'steady';
  if (variant === 'runt') return r < 0.6 ? 'skitter' : 'steady';
  if (type === 'spider') return r < 0.5 ? 'stalker' : 'steady';
  return r < 0.5 ? 'steady' : r < 0.78 ? 'stalker' : 'skitter';
}

/**
 * Which line this one takes (types.ts `Approach`). The mix is per type: vättar
 * take every line so a wave of them fans out; a troll is too heavy to weave
 * but will come round wide; the spider's pounce wants a flank; spitters and
 * the king have their own manners already. Rolled from the run's rng, so the
 * same seed hands every client the same horde.
 */
export function rollApproach(
  ctx: CombatHost,
  type: EnemyKind,
  rng: () => number = () => ctx.run.rng(),
): Approach {
  const r = rng();
  switch (type) {
    case 'runner':
      return r < 0.26 ? 'rush' : r < 0.5 ? 'jink' : r < 0.7 ? 'flank' : r < 0.88 ? 'arc' : 'tunnel';
    case 'troll':
      return r < 0.55 ? 'rush' : 'arc';
    case 'spider':
      return r < 0.5 ? 'rush' : 'flank';
    default:
      return 'rush';
  }
}

/** can this player reach this enemy, same room, so to speak */
export const sameFrame = (p: Pick<Player, 'frame'>, e: Enemy): boolean => sameFrameAs(p, e);
