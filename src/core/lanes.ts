import type { Mods } from './mods.ts';

/**
 * The LANES (decided in chat 2026-08-24, withdrawing the class tree; the
 * pool re-cut 2026-09-04): the game is stupid simple again. Everyone is a
 * sorcerer; the two big moments (party levels 5 and 12) each buy one pick
 * from ONE shared pool, and every pick mixes with every other, that is the
 * whole combination boom. Every lane is a DAMAGE MECHANIC with two tiers:
 *
 *   Lightning  I/II, waveclear by CHAINS; carries +30 max mana per tier
 *   Dark       I/II, SEEKING shots; II is the dark torrent: +5 pierce and
 *                     the BOOMERANG (out through them, back through them);
 *                     +30 max mana per tier
 *   Laddning   I/II, CHARGE: every hit charges the body; at three it
 *                     DETONATES, and a body that dies pops its charges onto
 *                     its neighbours, a pack is a fuse. II reaches
 *                     further, throws harder, charges neighbours twice.
 *                     Replaced Studs (ricochet) the same day it replaced
 *                     Bore, 2026-09-22 (from play: "bouncing doesn't always
 *                     happen and it's also lame")
 *   Impact     I/II, every fifth cast (III: third) is HEAVY: it shoves
 *                     what it hits along the line of fire, and whatever that
 *                     slams into, wall, column, car, another body, takes
 *                     impact damage, the other body shoved on in turn
 *
 * REMOVED 2026-09-04 (in chat): Shield (the toggled ward), Aura (the mode
 * aura) and Frost (slow + shove), with their effect code, the ward itself
 * is base kit and stays. A ticket can still slow (core/cards.ts).
 *
 * The mana story: base max mana was cut by 60, and the waveclear lanes carry
 * it, commit both picks to casting and you land where the old base did.
 */

export type LaneId = 'lightning' | 'dark' | 'laddning' | 'ram';

/** a lane pick every this many party levels, for ever */
export const LANE_EVERY = 5;
export interface LaneInfo {
  title: string;
  color: number;
  maxTier: number;
  t1: string;
  t2?: string;
}

export const LANE_INFO: Record<LaneId, LaneInfo> = {
  lightning: {
    title: 'Lightning',
    color: 0xaef0ff,
    maxTier: 2,
    t1: 'Your hits arc to 3 nearby enemies · +30 max mana',
    t2: 'Longer arcs chain to 6, hit harder, and stun · +30 max mana',
  },
  dark: {
    title: 'Dark',
    color: 0x9a6cf0,
    maxTier: 2,
    t1: 'Your bolts seek enemies · +30 max mana',
    t2: 'The dark torrent: +5 pierce, and every shot BOOMERANGS. Out through them, back through them · +30 max mana',
  },
  laddning: {
    title: 'Laddning',
    color: 0xffb61e,
    maxTier: 2,
    t1: 'CHARGE: every hit charges the body; at three it DETONATES, 2 m round · a kill pops its charges onto the pack · +30 max mana',
    t2: 'Detonations reach 3 m, throw harder, and charge each neighbour TWICE. A pack goes off as a cascade · +30 max mana',
  },
  ram: {
    title: 'Ram',
    color: 0xff9a5c,
    maxTier: 2,
    t1: 'Every 5th cast is a RAM: a heavy slug that hits three times as hard and DETONATES, driving what it hit into whatever is behind',
    t2: 'Every 4th cast · a wider, harder blast, and the body it drives takes the next one with it',
  },
};

/** what a lane pick needs to land on */
export interface Laned {
  lanes: Record<LaneId, number>;
  laneOrder: LaneId[];
  mods: Mods;
}

/** the cards for a player's next big moment: deepen what you have, or broaden */
export function laneOffer(p: Laned): string[] {
  const items: string[] = [];
  for (const id of Object.keys(LANE_INFO) as LaneId[]) {
    const tier = p.lanes[id];
    const info = LANE_INFO[id];
    if (tier === 0) items.push(`${id}:1`);
    else if (tier < info.maxTier) items.push(`${id}:${tier + 1}`);
  }
  return items;
}

export function laneCard(item: string): { title: string; color: number; desc: string } {
  const [id, tier] = item.split(':') as [LaneId, string];
  const info = LANE_INFO[id];
  return {
    title: `${info.title}${tier === '2' ? ' II' : ''}`,
    color: info.color,
    desc: (tier === '2' ? info.t2 : info.t1) ?? info.t1,
  };
}

/** apply one pick; returns what to say about it */
export function applyLanePick(p: Laned, item: string): string {
  const [id, tierS] = item.split(':') as [LaneId, string];
  const tier = Number(tierS);
  p.lanes[id] = tier;
  if (tier === 1) p.laneOrder.push(id);
  laneMods(p.mods, id, tier);
  return `${LANE_INFO[id].title}${tier === 2 ? ' II' : ''} chosen!`;
}

/**
 * What a lane at a given tier does to the numbers, with no record kept that
 * it was taken. Split out so a player's Mods can be REBUILT from what they
 * hold, the perks they picked, the lanes they took, the tickets on their
 * card, rather than carried about as derived state (§19: a player handed
 * between groups arrives as sources, and the receiving group recomputes).
 */
export function laneMods(m: Mods, id: LaneId, tier: number): void {
  if (id === 'lightning') {
    m.chain = tier >= 2 ? 6 : 3;
    m.zapStun = tier >= 2 ? 250 : 0;
    m.manaMaxBonus += 30;
  } else if (id === 'dark') {
    m.homing = tier >= 2 ? 6 : 4;
    if (tier >= 2) {
      m.pierce += 5;
      m.boomerang = 1;
    }
    m.manaMaxBonus += 30;
  } else if (id === 'laddning') {
    m.laddning = tier >= 2 ? 2 : 1;
    m.manaMaxBonus += 30;
  } else if (id === 'ram') {
    m.ramEvery = tier >= 2 ? 4 : 5;
    m.ramThrough = tier >= 2 ? 2 : 1;
    m.manaMaxBonus += 30;
  }
}
