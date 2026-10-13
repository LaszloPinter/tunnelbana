import * as C from '../config.ts';
import type { Mods } from './mods.ts';

/** the perk pool: what a level-up offers, and what each pick does to a player's Mods (core/mods.ts) */

export type PerkCat = 'cast' | 'bolt' | 'torrent' | 'nova' | 'move' | 'misc';

export const PERK_CAT_INFO: Record<PerkCat, { label: string; color: number }> = {
  cast: { label: 'BOLT+TORRENT', color: 0x7fd0e0 },
  bolt: { label: 'BOLT', color: 0x6fb8f0 },
  torrent: { label: 'TORRENT', color: 0xc08af0 },
  nova: { label: 'STÖT', color: 0x84d8a8 },
  move: { label: 'MOVE', color: 0xf0c060 },
  misc: { label: 'MISC', color: 0x9aa0b0 },
};

/** the only pictograms in the game, swap here and everything follows */
export const ICONS = {
  bolt: '✦',
  torrent: '≋',
  shield: '❖',
  both: '✧',
  none: '·',
} as const;

export type PerkEffect =
  | 'DMG'
  | 'RATE'
  | 'PIERCE'
  | 'LUCK'
  | 'REACH'
  | 'SPEED'
  | 'MONEY'
  | 'DEFENSE'
  | 'HP'
  | 'MANA'
  | 'COOLDOWN'
  | 'DODGE';

/** one "STAT  from → to" row on a perk card */
export interface PerkStat {
  icon: string;
  label: string;
  from: string;
  to: string;
}

export interface Perk {
  id: string;
  title: string;
  /** the perk's own pictogram, shown large on the card */
  icon: string;
  cat: PerkCat;
  effect: PerkEffect;
  /** stat rows, stacked on the card instead of a sentence */
  stats: (m: Mods) => PerkStat[];
  avail?: (m: Mods) => boolean;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** a kill's own chance of a mana orb (combat/enemyDeath.ts); the perk adds to it */
export const ORB_BASE = 0.075;
/** +5% a pick, three picks: 22.5% of kills at most, an orb being 9 mana
 * (tuned back from 10% a pick, the user's call 2026-09-24) */
const ORB_STEP = 0.05;
const ORB_CAP = 0.15;
/** +10% a pick, three picks; the second coin's base chance is 40%
 * (tuned back from 15% a pick, the user's call 2026-09-24) */
const COIN_STEP = 0.1;
const COIN_CAP = 0.3;

/** at its ceiling: shown greyed as MAX, and a pick of it is refused (combat/progression.ts) */
export const perkMaxed = (pk: Perk, m: Mods): boolean => !!pk.avail && !pk.avail(m);
const BOLT_MS = 320;
const TORRENT_MS = 90;

// Trimmed 2026-08-23 on play feedback: Greed went when gold became shared
// income; Quick Recovery, Shattering Shield and Dash Fury went as placeholders
// nobody picked ("fishing past them is the whole level-up"); the cast perks
// were renamed to SAY what they do. Nine remain: five for the casts, two for
// the ward, one for the feet, one panic button. Level-up picks are FREE now,
// money is for the kiosk's cards.
export const PERKS: Perk[] = [
  {
    id: 'quick-cast',
    icon: ICONS.both,
    effect: 'RATE',
    cat: 'cast',
    title: 'CAST RATE +15%',
    stats: (m) => [
      {
        icon: ICONS.bolt,
        label: 'RATE',
        from: `${Math.round(BOLT_MS * m.pistolRate)}ms`,
        to: `${Math.round(BOLT_MS * m.pistolRate * 0.85)}ms`,
      },
      {
        icon: ICONS.torrent,
        label: 'RATE',
        from: `${Math.round(TORRENT_MS * m.smgRate)}ms`,
        to: `${Math.round(TORRENT_MS * m.smgRate * 0.88)}ms`,
      },
    ],
  },
  {
    id: 'twin-casts',
    icon: ICONS.both,
    effect: 'LUCK',
    cat: 'cast',
    title: 'MULTICAST +25%',
    // once the twin is certain the stack rolls into a THIRD bolt, and the
    // card stops being offered when that is certain too: +25% on a stat
    // already at 100% is not an offer (from play 2026-09-04)
    avail: (m) => m.tripleTap < 1,
    stats: (m) =>
      m.doubleTap >= 1
        ? [{ icon: ICONS.both, label: 'TRIPLE', from: pct(m.tripleTap), to: pct(m.tripleTap + 0.25) }]
        : [{ icon: ICONS.both, label: 'DOUBLE', from: pct(m.doubleTap), to: pct(m.doubleTap + 0.25) }],
  },
  {
    id: 'empowered-bolts',
    icon: ICONS.both,
    effect: 'DMG',
    cat: 'cast',
    title: '+1 DMG',
    stats: (m) => [
      { icon: ICONS.bolt, label: 'DMG', from: `${2 + 2 * m.bulletDamage}`, to: `${4 + 2 * m.bulletDamage}` },
      { icon: ICONS.torrent, label: 'DMG', from: `${1 + m.bulletDamage}`, to: `${2 + m.bulletDamage}` },
    ],
  },
  {
    id: 'piercing-bolts',
    icon: ICONS.both,
    effect: 'PIERCE',
    cat: 'cast',
    title: '+1 PIERCE',
    stats: (m) => [{ icon: ICONS.both, label: 'PIERCE', from: `${m.pierce}`, to: `${m.pierce + 1}` }],
  },
  // Swift Bolts (+25% shot speed) went 2026-09-24: a bolt already crosses
  // the screen in under a second and outlives it, so the pick did nothing.
  // Two drops took its place, each CAPPED after three picks (the user's
  // call: "no infinite mana or insane income"), a capped perk still turns
  // up in the draw, greyed and marked MAX, so the ceiling is something you
  // can see rather than a card that silently stopped coming.
  {
    id: 'mana-orbs',
    icon: ICONS.none,
    effect: 'MANA',
    cat: 'misc',
    title: 'MANA ORB CHANCE',
    stats: (m) => [
      {
        icon: ICONS.none,
        label: 'ORB',
        from: pct(ORB_BASE + m.orbChance),
        to: pct(ORB_BASE + m.orbChance + ORB_STEP),
      },
    ],
    avail: (m) => m.orbChance < ORB_CAP - 1e-9,
  },
  {
    id: 'coin-luck',
    icon: ICONS.none,
    effect: 'LUCK',
    cat: 'misc',
    title: 'EXTRA COIN CHANCE',
    stats: (m) => [
      { icon: ICONS.none, label: 'COIN', from: pct(m.coinLuck), to: pct(m.coinLuck + COIN_STEP) },
    ],
    avail: (m) => m.coinLuck < COIN_CAP - 1e-9,
  },
  {
    id: 'big-nova',
    icon: ICONS.shield,
    effect: 'REACH',
    cat: 'nova',
    title: 'STÖT +25% REACH',
    stats: (m) => [
      { icon: ICONS.shield, label: 'REACH', from: pct(m.novaRadius), to: pct(m.novaRadius + 0.25) },
    ],
  },
  {
    id: 'quick-nova',
    icon: ICONS.shield,
    effect: 'COOLDOWN',
    cat: 'nova',
    title: 'STÖT COOLDOWN −25%',
    stats: (m) => [
      {
        icon: ICONS.shield,
        label: 'COOLDOWN',
        from: `${Math.round(18 * m.novaCd)} s`,
        to: `${Math.round(18 * m.novaCd * 0.75)} s`,
      },
    ],
  },
  {
    id: 'sprint',
    icon: ICONS.none,
    effect: 'SPEED',
    cat: 'move',
    title: 'MOVE +12%',
    stats: (m) => [
      {
        icon: ICONS.none,
        label: 'MOVE',
        from: `×${m.moveSpeed.toFixed(2)}`,
        to: `×${Math.min(C.MOVE_SPEED_CAP, m.moveSpeed * 1.12).toFixed(2)}${m.moveSpeed * 1.12 > C.MOVE_SPEED_CAP ? ' (cap)' : ''}`,
      },
    ],
  },
  {
    id: 'panic',
    icon: ICONS.none,
    effect: 'DEFENSE',
    cat: 'misc',
    title: 'SHOVE ON HIT',
    stats: (m) => [
      { icon: ICONS.none, label: 'SHOVE ON HIT', from: pct(m.retaliate), to: pct(m.retaliate + 0.35) },
    ],
  },
  // the numbers that used to be green cards: the +N belongs here
  {
    id: 'nimble',
    icon: ICONS.none,
    effect: 'DODGE',
    cat: 'misc',
    title: '+10% DODGE',
    stats: (m) => [
      {
        icon: ICONS.none,
        label: 'DODGE',
        from: pct(Math.min(0.5, m.dodge)),
        to: pct(Math.min(0.5, m.dodge + 0.1)),
      },
    ],
  },
  {
    id: 'reservoir',
    icon: ICONS.both,
    effect: 'MANA',
    cat: 'cast',
    title: '+20 MAX MANA',
    stats: (m) => [
      { icon: ICONS.both, label: 'MAX MANA', from: `+${m.manaMaxBonus}`, to: `+${m.manaMaxBonus + 20}` },
    ],
  },
];

export const applyPerk = (id: string, m: Mods): void => {
  switch (id) {
    case 'quick-cast':
      m.pistolRate *= 0.85;
      m.smgRate *= 0.88;
      break;
    case 'twin-casts':
      if (m.doubleTap >= 1) m.tripleTap = Math.min(1, m.tripleTap + 0.25);
      else m.doubleTap = Math.min(1, m.doubleTap + 0.25);
      break;
    case 'empowered-bolts':
      m.bulletDamage += 1;
      break;
    case 'piercing-bolts':
      m.pierce += 1;
      break;
    case 'mana-orbs':
      m.orbChance = Math.min(ORB_CAP, m.orbChance + ORB_STEP);
      break;
    case 'coin-luck':
      m.coinLuck = Math.min(COIN_CAP, m.coinLuck + COIN_STEP);
      break;
    case 'big-nova':
      m.novaRadius += 0.25;
      break;
    case 'quick-nova':
      m.novaCd *= 0.75;
      break;
    case 'sprint':
      m.moveSpeed *= 1.12;
      break;
    case 'panic':
      m.retaliate += 0.35;
      break;
    case 'nimble':
      // capped at a coin flip: no build dodges everything (the user's call)
      m.dodge = Math.min(0.5, m.dodge + 0.1);
      break;
    case 'reservoir':
      m.manaMaxBonus += 20;
      break;
  }
};
