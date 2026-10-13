import type { Mods } from './mods.ts';
import { TICKETS, none, type Ticket, type TicketBand } from './tickets.ts';

/**
 * THE SL CARD AND ITS TICKETS (§16, decided in chat 2026-08-26).
 *
 * Two parallel systems. Level-up PERKS are numbers, +1 DMG, +1 PIERCE,
 * picked in three seconds mid-fight. TICKETS are rules, they change how
 * you play the next station, bought calmly at a cleared station's kiosk,
 * named like Balatro jokers, and expensive. The test for any effect: can
 * it be written as +N? Then it is a perk. Does it change what you do?
 * Then it is a ticket.
 *
 * Every player carries ONE card. Tickets are loaded onto it, and the card's
 * tier is how many it holds: blue (you start with it) one, green two,
 * yellow three.
 *
 * THE BLACK CARD holds three, exactly as the yellow does, it is a trophy,
 * not a power spike (the user's call, 2026-09-06). It cannot be bought at
 * any price: Bergakungen drops it and nothing else in the game gives it.
 * What it is FOR is not written on it, and is not advertised anywhere; a
 * player who fells the king finds a black card in their pocket and has to
 * work out why it is not just a yellow one.
 *
 * Order matters, Dubbelbiljett copies the ticket BELOW it, so a
 * player can reorder any time from the pause screen; a reorder is a choice
 * input like any other, so every client agrees.
 *
 * A ticket's effect is a delta on Mods, applied +1 when it becomes
 * effective and −1 when it stops; anything that is not a Mods number
 * (the leech, the magnet, the burst) is read off the card by the code that
 * needs it, through `hasTicket`. `effectiveTickets` is the one place that
 * resolves what a card DOES from what it holds.
 */

export type CardTier = 'blue' | 'green' | 'yellow' | 'black';
export { TICKETS, type Ticket, type TicketBand } from './tickets.ts';

export const TIER_INFO: Record<CardTier, { label: string; color: number; slots: number; price: number }> = {
  blue: { label: 'BLUE CARD', color: 0x2f9bd8, slots: 1, price: 0 },
  green: { label: 'GREEN CARD', color: 0x3fae5a, slots: 2, price: 200 },
  yellow: { label: 'YELLOW CARD', color: 0xe8c23a, slots: 3, price: 450 },
  // never for sale: the price is here only because the shape says so
  black: { label: 'BLACK CARD', color: 0x14141a, slots: 3, price: 0 },
};
/** what the kiosk will sell you next, and it will never sell you a black one */
export const NEXT_TIER: Record<CardTier, CardTier | null> = {
  blue: 'green',
  green: 'yellow',
  yellow: null,
  black: null,
};
export const slotsFor = (tier: CardTier): number => TIER_INFO[tier].slots;
export const MAX_SLOTS = 3;

export const BAND_INFO: Record<TicketBand, { price: number; weight: number; label: string }> = {
  cheap: { price: 120, weight: 6, label: 'ENKEL' },
  mid: { price: 250, weight: 3, label: 'PERIOD' },
  rare: { price: 500, weight: 1, label: 'SÄLLSYNT' },
};

export const ticketById = (id: string): Ticket | undefined => TICKETS.find((t) => t.id === id);
/** `mul` is the kiosk's discount, from kioskMul */
export const ticketPrice = (t: Ticket, mul = 1): number => Math.round(BAND_INFO[t.band].price * mul);
/** what the kiosk gives back for a ticket: half */
export const ticketSellPrice = (t: Ticket): number => Math.floor(BAND_INFO[t.band].price / 2);

/**
 * What a card DOES from what it holds: Dubbelbiljett becomes the ticket
 * BELOW it (never another Dubbelbiljett, never nothing). The card is drawn
 * as a vertical strip, so "below" is the next slot, it read "to its right"
 * until 2026-09-04, which described a layout the game has never had.
 */
export function effectiveTickets(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id === 'dubbel') {
      const next = ids[i + 1];
      if (next && next !== 'dubbel') out.push(next);
    } else out.push(id);
  }
  return out;
}

export interface Carded {
  cards: string[];
  mods: Mods;
}

/** apply (+1) or withdraw (−1) everything the card currently does */
export function applyTickets(p: Carded, dir: 1 | -1): void {
  for (const id of effectiveTickets(p.cards)) ticketById(id)?.apply(p.mods, dir);
}

/** change what the card holds, keeping Mods exactly in step */
export function withTickets(p: Carded, change: (ids: string[]) => void): void {
  applyTickets(p, -1);
  change(p.cards);
  applyTickets(p, 1);
}

export const hasTicket = (p: { cards: string[] }, id: string): boolean =>
  effectiveTickets(p.cards).includes(id);
/** how many copies the card carries, the counted rules scale with it */
export const ticketCount = (p: { cards: string[] }, id: string): number =>
  effectiveTickets(p.cards).filter((t) => t === id).length;

/**
 * THE RULES THAT COUNT COPIES: a second one does more, not nothing. Every
 * ticket that is not a Mods number is read through `ticketCount`, so a
 * Dubbelbiljett copying it, or a second one bought, always does
 * something (from play 2026-09-28: "I think Dubbelbiljett does nothing").
 */
const COUNTED = new Set([
  'blodsugare',
  'manasugare',
  'reskassa',
  'magnet',
  'rusning',
  'kedjebrev',
  'smittspridare',
  'aterbaring',
  'rabattkort',
  'reservkraft',
]);

/** Rabattkort, per copy: the kiosk 25% off, the machines half price */
export const kioskMul = (p: { cards: string[] }): number => 0.75 ** ticketCount(p, 'rabattkort');
export const machineMul = (p: { cards: string[] }): number => 0.5 ** ticketCount(p, 'rabattkort');

/**
 * WHERE A BOUGHT TICKET GOES. At the bottom, except a Dubbelbiljett, which
 * goes ABOVE the last ticket, so it copies something from the moment it is
 * bought. Pushed to the bottom like the rest it sat under nothing, copied
 * nothing, and only a drag on the pause screen (which nothing said to do)
 * ever woke it up.
 */
export function slotFor(ids: readonly string[], id: string): number {
  if (id !== 'dubbel') return ids.length;
  const last = ids.length - 1;
  return last >= 0 && ids[last] !== 'dubbel' ? last : ids.length;
}
/** a ticket a Dubbelbiljett is worth copying: a number on Mods, or a counted rule */
export const stacks = (t: Ticket): boolean => t.apply !== none || COUNTED.has(t.id);

/**
 * The kiosk's shelf: n tickets by band weight, no two the same, and NEVER
 * one you already hold (the user's call, 2026-09-28). One ticket per type
 * is the rule; the Dubbelbiljett is the one way to hold something twice,
 * that is the whole point of finding it.
 */
export function rollShelf(rng: () => number, held: string[], n: number): string[] {
  // ...and never one from under the counter (core/tickets.ts black)
  const pool = TICKETS.filter((t) => !t.black && !held.includes(t.id));
  const out: string[] = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((s, t) => s + BAND_INFO[t.band].weight, 0);
    let r = rng() * total;
    let pick = pool[pool.length - 1];
    for (const t of pool) {
      r -= BAND_INFO[t.band].weight;
      if (r <= 0) {
        pick = t;
        break;
      }
    }
    out.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}
