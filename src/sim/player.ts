import type { CardTier } from '../core/cards.ts';
import * as C from '../config.ts';
import type { Frame } from '../core/world.ts';
import { defaultMods, type Mods } from '../core/mods.ts';
import type { LaneId } from '../core/lanes.ts';

import { EMPTY_INPUT, type TickInput } from './tick.ts';

/**
 * One commuter. Everything the simulation knows about a player, and nothing
 * the renderer does, plain data, so four of them fit in a room and all of
 * them fit in a snapshot.
 *
 * This used to be thirty-odd fields on the scene, and every combat module
 * read THE player through them: enemies hunted `ctx.px`, the ward was
 * `ctx.shieldUp`, loot went to `ctx.money`. There is no multiplayer of any
 * kind until the player is a value that can be one of several, which is why
 * this file exists before any networking does. Single player is
 * `players.length === 1`.
 */

export type Weapon = 'pistol' | 'smg';

/**
 * What the simulation is holding out to a player: the cards of a level-up
 * or an element moment. Rolled from the run's stream inside a tick, so
 * every client sees the same cards; answered by `TickInput.choice`. The
 * screen that shows it is the renderer's business and draws from this.
 */
export interface Offer {
  /** a level-up's cards, a class moment's, or the kiosk's shelf (§16) */
  kind: 'perk' | 'element' | 'shop' | 'bag';
  /** a bag's owner: the passenger it belongs to (combat/langaren.ts) */
  who?: number;
  /** perk ids, or element cards as `${el}:${tier}`, in the order the choice codes count */
  items: string[];
  /** sim time it opened, so a pick cannot land in the same instant */
  openedAt: number;
  /** the free once-per-level reroll, if it has not been spent */
  canReroll: boolean;
}

/**
 * What the party holds in common (§16): one xp pool, one level, so everyone
 * reaches the class moments together; and whether the world is standing
 * still for a pick.
 */
export interface Party {
  xp: number;
  level: number;
  xpNext: number;
}

/**
 * The world standing still for a pick, a SIM phase, not a client freeze
 * (§16): ticks keep flowing and carry the picks, but sim time is held, so
 * trains, timers and the horde wait. A class moment holds until every seat
 * has chosen.
 *
 * An ordinary level-up holds for a GRACE and then lets the world run, with
 * whoever is still choosing standing still in it, because three other
 * people cannot be made to wait on one player's reading. Alone, there is
 * nobody to wait for: the alpha ships single-player (§15) and the timer was
 * only ever a courtesy to a room, so one seat holds outright and reads the
 * cards (decided in chat 2026-09-06).
 */
export interface Pause {
  kind: 'class' | 'level' | 'ride';
  /** ticks of hold left; Infinity for a class moment, and for a lone seat */
  left: number;
  /** between rides: the seats (bit per id) that have said go */
  ready?: number;
}

/** ticks an ordinary level-up holds the world for a ROOM before it runs on */
export const LEVEL_GRACE_TICKS = 180;

export const makeParty = (): Party => ({ xp: 0, level: 1, xpNext: 6 });

/** xp to the next level: grows with the level, and a little with the party */
export const xpToNext = (level: number, seats: number): number =>
  Math.round((6 + (level - 1) * 4) * (1 + 0.4 * (seats - 1)));

/** max mana grows with the party's level, and with the cards you hold */
export const manaMax = (party: Party, p: { mods: Mods }): number =>
  C.MANA_MAX + (party.level - 1) * 14 + p.mods.manaMaxBonus;

/** max HP: the class's, plus the cards' */
export const maxHp = (p: { maxHealth: number; mods: Mods }): number =>
  Math.round((p.maxHealth + p.mods.maxHealthBonus) * p.mods.hpMul);

export interface Player {
  /** seat in the room, 0..3; also the index into `players` */
  id: number;
  /**
   * WHICH PLACE this seat is standing in (§17), `st:Name` for a station.
   * Half a party can be at one station while the other half is at another,
   * so where a seat is has to be part of the seat, not of the world.
   */
  placeId: string;
  /** the input this tick runs on, never the live keyboard */
  input: TickInput;
  /** alive and stepping. A dead player is skipped, not removed: ids are seats */
  alive: boolean;
  /**
   * On the floor (§11c): hp gone, or taken by the tunnel. Not dead, a
   * teammate holds E beside them to bring them back. A downed player cannot
   * act, is not targeted, takes no further damage, and rides whatever frame
   * they fell in. The run ends when NOBODY is left standing.
   */
  downed: boolean;
  /** revive progress, seconds of a teammate's held E; decays alone */
  reviveProgress: number;
  /** sim time the progress last grew, so decay knows nobody is kneeling */
  reviveHeldAt: number;

  // ---- where ----
  frame: Frame;
  x: number;
  y: number;
  r: number;
  /** facing, for the rig: which way the legs point and whether they stride */
  moveDirX: number;
  moveDirY: number;
  movingInput: boolean;

  // ---- vitals ----
  health: number;
  mana: number;
  money: number;
  iframesUntil: number;
  /** a bumped train does not bump twice: grace after a tumble */
  noTrainHitUntil: number;

  // ---- the dash ----
  /** 0 = not dashing; otherwise the ms the dash began at */
  jumpStart: number;
  jumpCdUntil: number;
  /** landing was blocked: still airborne until somewhere clear */
  gliding: boolean;
  dashDirX: number;
  dashDirY: number;
  /** enemies this dash has already hit */
  dashHit: Set<number>;

  // ---- casting ----
  weapon: Weapon;
  castKind: 'none' | 'once' | 'hold';
  castStart: number;
  castHoldUntil: number;
  fireCdUntil: number;
  torrentHeat: number;
  nextManaAt: number;
  /** STÖT is ready again from this time (combat/casting.ts stepNova) */
  nextNovaAt: number;

  // ---- progression ----
  mods: Mods;
  maxHealth: number;
  /** the LANES taken (core/lanes.ts): every sorcerer is a mix of these */
  lanes: Record<LaneId, number>;
  /** casts made, for the ram lane's every-Nth heavy cast */
  castCount: number;
  /** level-up draws made, so the Nth offer of a seat is the seed's (§16) */
  perkDraws: number;
  laneOrder: LaneId[];
  /** dashes in hand; the aura lane carries two */
  dashStock: number;
  /** when the next spent dash charge comes back */
  dashRegenAt: number;
  pendingElement: number;
  pendingLevels: number;
  perkCounts: Map<string, number>;
  rerollBlocked: boolean;
  /** the cards on the table, if any */
  offer: Offer | null;
  /** the card's tier, how many tickets it holds (core/cards.ts) */
  cardTier: CardTier;
  /** the tickets loaded on the card, by id, in order, yours alone */
  cards: string[];
  /**
   * This station's shelf for this player: rolled ONCE per station on the
   * first visit to any kiosk, the same whichever window you open, and thinned
   * as you buy, never re-rolled by walking away and coming back.
   */
  shelf: string[] | null;
  /** Langaren's timed boosts (core/bag.ts): kind → the moment it wears off */
  boosts: Record<string, number>;
  kills: number;
}

export function makePlayer(id: number): Player {
  return {
    id,
    placeId: 'st:T-Centralen',
    input: EMPTY_INPUT,
    alive: true,
    downed: false,
    reviveProgress: 0,
    reviveHeldAt: 0,
    frame: { kind: 'world' },
    x: 0,
    y: 0,
    r: C.M(0.55),
    moveDirX: 0,
    moveDirY: 0,
    movingInput: false,
    health: 100,
    mana: C.MANA_START,
    money: 0,
    iframesUntil: 0,
    noTrainHitUntil: 0,
    jumpStart: 0,
    jumpCdUntil: 0,
    gliding: false,
    dashDirX: 1,
    dashDirY: 0,
    dashHit: new Set(),
    weapon: 'pistol',
    castKind: 'none',
    castStart: 0,
    castHoldUntil: 0,
    fireCdUntil: 0,
    torrentHeat: 0,
    nextManaAt: 0,
    nextNovaAt: 0,
    mods: defaultMods(),
    maxHealth: 100,
    lanes: { lightning: 0, dark: 0, laddning: 0, ram: 0 },
    castCount: 0,
    perkDraws: 0,
    laneOrder: [],
    dashStock: 1,
    dashRegenAt: 0,
    pendingElement: 0,
    pendingLevels: 0,
    perkCounts: new Map(),
    rerollBlocked: false,
    offer: null,
    cards: [],
    shelf: null,
    boosts: {},
    cardTier: 'blue',
    kills: 0,
  };
}

export * from './playerRules.ts';
