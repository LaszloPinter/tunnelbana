import * as C from '../config.ts';
import { BAG_ITEMS, BLACK_TICKET_PRICE, BOOST_MS, type BoostKind } from '../core/bag.ts';
import { slotFor, slotsFor, ticketById, TICKETS, withTickets } from '../core/cards.ts';
import { dist } from '../sim/det.ts';
import { sayLine, type Passenger } from '../sim/passenger.ts';
import { manaMax, maxHp, type Offer, type Player } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';
import { CHOICE } from '../sim/tick.ts';

/**
 * LANGAREN (DESIGN §20): the dealer riding the tunnelbana. E beside him
 * opens his bag, a person, not the station's kiosk, so whether the
 * station is cleared does not come into it; his limit is time (he rides on
 * like anyone) and the horde (a dead dealer's bag is gone with him). His
 * stock is his own, rolled from his stream once, and each thing in it is
 * sold once.
 */
export const DEALER_REACH = C.M(2.4);

/** the dealer within reach of this seat, on the same floor, or in the same train */
export function dealerNear(run: Run, p: Player): Passenger | null {
  for (const ps of run.pax) {
    if (!ps.alive || ps.kind !== 'langare') continue;
    const sameRoom =
      ps.mode === 'foot'
        ? p.frame.kind === 'world' && ps.placeId === p.placeId
        : p.frame.kind === 'aboard' && p.frame.jid === ps.jid;
    if (sameRoom && dist(ps.x - p.x, ps.y - p.y) < DEALER_REACH) return ps;
  }
  return null;
}

/** what he carries: two of the three boosts, mana, a ticket from under the counter, and for the black card, more */
function stockOf(run: Run, ps: Passenger, p: Player): string[] {
  if (!ps.stock) {
    const rng = run.contentRng(`bag:${ps.id}`);
    const boosts = ['boost:cast', 'boost:stot', 'boost:dash'];
    boosts.splice(Math.floor(rng() * 3), 1);
    const black = TICKETS.filter((t) => t.black);
    ps.stock = [...boosts, 'mana', `ticket:${black[Math.floor(rng() * black.length)].id}`];
  }
  const out = ps.stock.filter((id) => !id.startsWith('ticket:') || !p.cards.includes(id.slice(7)));
  // THE BLACK CARD is his tell: he reaches under the counter
  if (p.cardTier === 'black' && !out.includes('special')) out.push('special');
  return out;
}

/** E beside him: the bag opens. True if it did (or he was there to say no) */
export function openBag(run: Run, p: Player, now: number): boolean {
  if (p.offer) return false;
  const ps = dealerNear(run, p);
  if (!ps) return false;
  const items = stockOf(run, ps, p);
  if (items.length === 0) {
    run.showMsg('His bag is empty. He shrugs.', now, p);
    return true;
  }
  p.offer = { kind: 'bag', items, openedAt: now, canReroll: false, who: ps.id };
  if (now - ps.sayAt > 4000) sayLine(run, ps, 'greet', now);
  return true;
}

export const priceOf = (id: string): number =>
  id.startsWith('ticket:') ? BLACK_TICKET_PRICE : (BAG_ITEMS[id]?.price ?? 0);

/** a pick from the bag, or the bag closes because he has gone */
export function stepBag(run: Run, p: Player, offer: Offer, now: number) {
  const ps = run.pax.find((q) => q.id === offer.who);
  if (!ps || !ps.alive || dealerNear(run, p) !== ps) {
    p.offer = null;
    return;
  }
  const choice = p.input.choice;
  if (choice === CHOICE.none) return;
  if (choice === CHOICE.skip) {
    p.offer = null;
    return;
  }
  const id = offer.items[choice - 1];
  if (!id) return;
  const price = priceOf(id);
  if (p.money < price) {
    run.showMsg(`${price} kr. You don't have it.`, now, p);
    return;
  }
  if (id.startsWith('ticket:')) {
    const t = ticketById(id.slice(7));
    if (!t) return;
    if (p.cards.length >= slotsFor(p.cardTier)) {
      run.showMsg('Your card is full: sell a ticket at a kiosk first.', now, p);
      return;
    }
    withTickets(p, (ids) => ids.splice(slotFor(ids, t.id), 0, t.id));
    run.showMsg(`${t.title}: loaded (−${price} kr). Nobody saw a thing.`, now, p);
  } else if (id.startsWith('boost:')) {
    p.boosts[id.slice(6) as BoostKind] = now + BOOST_MS;
    run.showMsg(`${BAG_ITEMS[id].title} (−${price} kr)`, now, p);
  } else if (id === 'mana') {
    p.mana = Math.min(manaMax(run.party, p), p.mana + 80);
    run.showMsg(`+80 mana (−${price} kr)`, now, p);
  } else if (id === 'special') {
    for (const k of ['cast', 'stot', 'dash']) p.boosts[k] = now + 90_000;
    p.mana = manaMax(run.party, p);
    p.health = maxHp(p);
    run.showMsg(`${BAG_ITEMS.special.title} (−${price} kr)`, now, p);
  } else return;
  p.money -= price;
  // the click that chose must not become a cast
  p.fireCdUntil = Math.max(p.fireCdUntil, now + 350);
  // sold once: gone from his bag, and from the offer
  ps.stock = (ps.stock ?? []).filter((x) => x !== id);
  offer.items = offer.items.filter((x) => x !== id);
  sayLine(run, ps, 'gift', now);
  if (offer.items.length === 0) p.offer = null;
}
