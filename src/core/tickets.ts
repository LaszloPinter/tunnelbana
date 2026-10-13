import type { Mods } from './mods.ts';

/**
 * THE TICKETS THEMSELVES (core/cards.ts says what a card is and does).
 *
 * A ticket's effect is a delta on Mods, applied +1 when it becomes effective
 * and −1 when it stops; anything that is not a Mods number (the leech, the
 * magnet, the burst) is read off the card by the code that needs it, through
 * `hasTicket` / `ticketCount`.
 */

export type TicketBand = 'cheap' | 'mid' | 'rare';

export interface Ticket {
  id: string;
  title: string;
  band: TicketBand;
  desc: string;
  apply: (m: Mods, dir: 1 | -1) => void;
  /** SOLD UNDER THE COUNTER: never on a kiosk's shelf, only Langaren has
   * these (combat/langaren.ts, DESIGN §20). Strong, and each with a price */
  black?: boolean;
}

const mul = (k: keyof Mods, f: number) => (m: Mods, dir: 1 | -1) => {
  (m[k] as number) = dir > 0 ? (m[k] as number) * f : (m[k] as number) / f;
};
const add = (k: keyof Mods, n: number) => (m: Mods, dir: 1 | -1) => {
  (m[k] as number) = (m[k] as number) + dir * n;
};
const both =
  (...fs: ((m: Mods, dir: 1 | -1) => void)[]) =>
  (m: Mods, dir: 1 | -1) => {
    for (const f of fs) f(m, dir);
  };
export const none = () => {};

/**
 * THIRTY-THREE TICKETS, AND THEY REPEAT (the user's call, 2026-09-17: "just
 * more than 17, they can repeat, no gating"). A ticket that is a number on
 * Mods stacks, and so does every counted rule, but the kiosk sells one of
 * each, so the only way to hold one twice is a Dubbelbiljett (2026-09-28).
 * Tickets stand OUTSIDE the perks' caps (Mods ticketMove / ticketCast).
 */
export const TICKETS: Ticket[] = [
  // ---- enkel: the everyday
  {
    id: 'skarpskytt',
    title: 'Skarpskytt',
    band: 'cheap',
    desc: '+25% bolt damage',
    apply: mul('boltMul', 1.25),
  },
  {
    id: 'snabbkassa',
    title: 'Snabbkassa',
    band: 'cheap',
    desc: 'Cast 20% faster',
    apply: mul('ticketCast', 1 / 1.2),
  },
  {
    id: 'langskott',
    title: 'Långskott',
    band: 'cheap',
    // was "fly 50% farther and 20% faster" until 2026-09-24, a bolt already
    // outflew the screen, so the ticket bought nothing you could see
    desc: 'A bolt that has flown 8 m hits for +50%',
    apply: add('longShot', 0.5),
  },
  {
    id: 'lattfotad',
    title: 'Lättfotad',
    band: 'cheap',
    desc: 'Dash cooldown −40%',
    apply: mul('dashCd', 0.6),
  },
  {
    id: 'turbiljett',
    title: 'Turbiljett',
    band: 'cheap',
    desc: '+20% chance of an extra coin',
    apply: add('coinChance', 0.2),
  },
  { id: 'plaster', title: 'Plåster', band: 'cheap', desc: '+2 HP per second', apply: add('hpRegen', 2) },
  {
    id: 'magnet',
    title: 'Magnet',
    band: 'cheap',
    desc: 'Coins and mana orbs within 6 m drift to you',
    apply: none,
  },
  { id: 'reskassa', title: 'Reskassa', band: 'cheap', desc: '+40% kr from every source', apply: none },
  {
    id: 'tjockhud',
    title: 'Tjockhud',
    band: 'cheap',
    desc: '+15% max HP',
    apply: mul('hpMul', 1.15),
  },
  {
    id: 'akstrafe',
    title: 'Åkstrafe',
    band: 'cheap',
    desc: '+60% move speed',
    apply: mul('ticketMove', 1.6),
  },
  {
    id: 'nattbuss',
    title: 'Nattbuss',
    band: 'cheap',
    desc: 'Your dash goes twice as far',
    apply: mul('dashLen', 2),
  },
  // ---- period: worth the fare
  { id: 'pansar', title: 'Pansar', band: 'mid', desc: '+30% max HP', apply: mul('hpMul', 1.3) },
  {
    id: 'spets',
    title: 'Spets',
    band: 'mid',
    desc: 'Bolts pass through 2 more enemies',
    apply: add('pierce', 2),
  },
  {
    id: 'dubbelskott',
    title: 'Dubbelskott',
    band: 'mid',
    desc: '+35% chance a bolt casts twice',
    apply: add('doubleTap', 0.35),
  },
  {
    id: 'stotdampare',
    title: 'Stötdämpare',
    band: 'mid',
    desc: 'STÖT cooldown halved',
    apply: mul('novaCd', 0.5),
  },
  {
    id: 'vidgning',
    title: 'Vidgning',
    band: 'mid',
    desc: 'STÖT reaches 50% farther',
    apply: mul('novaRadius', 1.5),
  },
  {
    id: 'kritiker',
    title: 'Kritiker',
    band: 'mid',
    desc: '+20% crit chance · crits deal double',
    apply: (m, d) => {
      m.critChance += d * 0.2;
      if (d > 0) m.critMul = Math.max(m.critMul, 2);
      else if (m.critChance <= 1e-9) m.critMul = 1;
    },
  },
  { id: 'extraresa', title: 'Extraresa', band: 'mid', desc: '+1 dash in hand', apply: add('dashCharges', 1) },
  {
    id: 'panikbroms',
    title: 'Panikbroms',
    band: 'mid',
    desc: 'Getting hit shoves everything near you, half the time',
    apply: add('retaliate', 0.5),
  },
  {
    id: 'harmask',
    title: 'Hårmask',
    band: 'mid',
    desc: 'Dashing through the horde hurts it: +3 damage',
    apply: add('dashDamage', 3),
  },
  { id: 'blodsugare', title: 'Blodsugare', band: 'mid', desc: 'Every kill heals 2 HP', apply: none },
  { id: 'manasugare', title: 'Manasugare', band: 'mid', desc: 'Every kill returns 4 mana', apply: none },
  { id: 'rusning', title: 'Rusning', band: 'mid', desc: 'Cast 40% faster while standing still', apply: none },
  {
    id: 'isvinter',
    title: 'Isvinter',
    band: 'mid',
    desc: 'Everything you hit is slowed',
    apply: (m, d) => {
      if (d > 0) m.slowMs = Math.max(m.slowMs, 1400);
      else if (m.slowMs === 1400) m.slowMs = 0;
    },
  },
  {
    id: 'kedjebrev',
    title: 'Kedjebrev',
    band: 'mid',
    desc: 'Every kill arcs lightning to one enemy nearby',
    apply: none,
  },
  {
    id: 'smittspridare',
    title: 'Smittspridare',
    band: 'mid',
    desc: 'A dying enemy bursts for 30% of its max HP within 2 m',
    apply: none,
  },
  {
    id: 'stotvag',
    title: 'Stötvåg',
    band: 'mid',
    desc: 'STÖT hits twice as hard and throws twice as far',
    apply: mul('novaPower', 2),
  },
  {
    id: 'aterbaring',
    title: 'Återbäring',
    band: 'mid',
    desc: 'Every train toward your destination that leaves without you pays 60 kr',
    apply: none,
  },
  {
    id: 'rabattkort',
    title: 'Rabattkort',
    band: 'mid',
    desc: 'Vending machines half price · kiosk 25% off',
    apply: none,
  },
  // ---- sällsynt: rare
  {
    id: 'krutdurk',
    title: 'Krutdurk',
    band: 'rare',
    desc: 'Detonations hit 50% harder',
    apply: mul('blastMul', 1.5),
  },
  {
    id: 'hemvandare',
    title: 'Hemvändare',
    band: 'rare',
    desc: 'Bolts curve toward the horde',
    apply: add('homing', 3),
  },
  {
    id: 'snabbtag',
    title: 'Snabbtåg',
    band: 'rare',
    desc: '+40% move speed · +40% cast speed',
    apply: both(mul('ticketMove', 1.4), mul('ticketCast', 1 / 1.4)),
  },
  {
    id: 'jattekraft',
    title: 'Jättekraft',
    band: 'rare',
    desc: '+50% max HP',
    apply: mul('hpMul', 1.5),
  },
  {
    id: 'arskort',
    title: 'Årskort',
    band: 'rare',
    desc: '+100 max mana · mana trickles back twice as fast',
    apply: both(add('manaMaxBonus', 100), mul('manaRegen', 2)),
  },
  {
    id: 'reservkraft',
    title: 'Reservkraft',
    band: 'rare',
    desc: 'Going down, you get back up at 30% HP, once. The ticket is used up',
    apply: none,
  },
  {
    id: 'dubbel',
    title: 'Dubbelbiljett',
    band: 'rare',
    desc: 'Copies the ticket below it. Drag to reorder',
    apply: none,
  },
  // ---- svart: what the dealer has, and nobody else
  {
    id: 'svarttaxi',
    title: 'Svarttaxi',
    band: 'rare',
    desc: '+80% move speed · −20% max HP',
    apply: both(mul('ticketMove', 1.8), mul('hpMul', 0.8)),
    black: true,
  },
  {
    id: 'smuggelgods',
    title: 'Smuggelgods',
    band: 'rare',
    desc: '+60% bolt damage · STÖT cools down 30% slower',
    apply: both(mul('boltMul', 1.6), mul('novaCd', 1.3)),
    black: true,
  },
  {
    id: 'nattpass',
    title: 'Nattpass',
    band: 'rare',
    desc: '+120 max mana · mana trickles back three times as fast',
    apply: both(add('manaMaxBonus', 120), mul('manaRegen', 3)),
    black: true,
  },
];
