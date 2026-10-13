/**
 * LANGAREN'S BAG (DESIGN §20): what the dealer on the tunnelbana sells,
 * never called a shop, never stocked like the kiosk. Timed boosts that act
 * at once, mana at a dealer's price, a ticket from under the counter, and
 * for the one holding the black card, something he offers nobody else.
 *
 * An item is a string in the offer: 'boost:cast', 'boost:stot',
 * 'boost:dash', 'mana', 'ticket:<id>', 'special'.
 */
export type BoostKind = 'cast' | 'stot' | 'dash';

export const BOOST_MS = 45_000;

export interface BagItem {
  title: string;
  desc: string;
  price: number;
}

export const BAG_ITEMS: Record<string, BagItem> = {
  'boost:cast': { title: 'Kaffe, starkt', desc: 'Cast 50% faster for 45 s', price: 90 },
  'boost:stot': { title: 'Nävar av sten', desc: 'STÖT hits 80% harder for 45 s', price: 90 },
  'boost:dash': { title: 'Lätta skor', desc: 'Dash back twice as fast for 45 s', price: 80 },
  mana: { title: 'Påse mana', desc: '+80 mana, now', price: 75 },
  special: {
    title: 'Kungens tjänst',
    desc: 'All three for 90 s, mana and HP full. For the black card only',
    price: 250,
  },
};

/** a black-market ticket's price: a premium on a rare one */
export const BLACK_TICKET_PRICE = 550;

/** is this boost running for this seat, now? */
export const boostActive = (p: { boosts: Record<string, number> }, k: BoostKind, now: number): boolean =>
  (p.boosts[k] ?? 0) > now;
