import { applyPerk, PERKS, perkMaxed } from '../core/perks.ts';
import { applyLanePick, laneOffer } from '../core/lanes.ts';
import {
  NEXT_TIER,
  TIER_INFO,
  kioskMul,
  slotFor,
  rollShelf,
  slotsFor,
  ticketById,
  ticketPrice,
  ticketSellPrice,
  withTickets,
} from '../core/cards.ts';
import { CHOICE, isSwapChoice, swapOf } from '../sim/tick.ts';
import { LEVEL_GRACE_TICKS, type Offer, type Player } from '../sim/player.ts';
import type { CombatHost } from './types.ts';
import { stepBag } from './langaren.ts';
import type { Run } from '../sim/run.ts';

/**
 * Level-ups and element moments, as simulation.
 *
 * The cards used to be rolled by the overlay with Math.random and applied by
 * a click handler, two things outside the tick stream, either of which puts
 * four clients in four different games. Now the OFFER is rolled here from
 * the run's stream and sits on the player as data, the screen only draws it,
 * and the pick arrives as `TickInput.choice` like any other button. Whether
 * the world waits while the cards are up is not decided here: single player
 * freezes its clock (a thing done TO a run, like pause); a room cannot, and
 * will answer with a deadline or a safe moment (§11c).
 */

/**
 * Does the world stand still for the picks? Called once a tick after every
 * seat's offers have been opened and resolved. A class moment (the element
 * cards) holds until nobody has one open. So does an ordinary level-up when
 * one seat is playing: there is nobody the hold is unfair to, and the pause
 * screen is where you actually read the cards. In a ROOM the level-up holds
 * for LEVEL_GRACE_TICKS from the first card and then lets the world run,
 * with a seat still choosing standing still in it. The grace is spent once
 * per level-up: when it runs out the pause is dropped and not re-raised
 * until every perk offer has closed and a new one opens.
 */
export function stepPause(ctx: CombatHost) {
  // BETWEEN RIDES (sim/chain.ts): the world holds until every living seat
  // has said go, the next ride starts when the party wants it to
  const pause = ctx.run.pause;
  if (pause?.kind === 'ride') {
    let all = true;
    for (const p of ctx.run.players) {
      if (!p.alive) continue;
      if (p.input.choice === CHOICE.go) pause.ready = (pause.ready ?? 0) | (1 << p.id);
      if (!((pause.ready ?? 0) & (1 << p.id))) all = false;
    }
    if (!all) return;
    ctx.run.pause = null;
    // the key that said go is not also a press in the world: E is the exit
    // key, and the party is standing at the exit it just came up through
    for (const p of ctx.run.players) p.input = { ...p.input, pressed: 0 };
    return;
  }
  let classOpen = false;
  let perkOpen = false;
  for (const p of ctx.run.players) {
    if (!p.alive || !p.offer) continue;
    if (p.offer.kind === 'element') classOpen = true;
    else if (p.offer.kind === 'perk') perkOpen = true;
  }
  if (classOpen) {
    if (!ctx.run.pause || ctx.run.pause.kind !== 'class') ctx.run.pause = { kind: 'class', left: Infinity };
    return;
  }
  if (!perkOpen) {
    ctx.run.pause = null;
    ctx.run.graceSpent = false;
    return;
  }
  const grace = ctx.run.players.length > 1 ? LEVEL_GRACE_TICKS : Infinity;
  if (ctx.run.pause) {
    ctx.run.pause.left -= 1;
    if (ctx.run.pause.left <= 0) {
      ctx.run.pause = null;
      ctx.run.graceSpent = true;
    }
  } else if (!ctx.run.graceSpent) {
    ctx.run.pause = { kind: 'level', left: grace };
  }
}

export function stepProgression(ctx: CombatHost, p: Player, now: number) {
  if (!p.offer) {
    // a reorder needs no kiosk: the pause screen sends it any time
    if (isSwapChoice(p.input.choice)) {
      const [i, j] = swapOf(p.input.choice);
      swapTickets(p, i, j);
    }
    // element moments (levels 5 and 12) take precedence over ordinary perks
    if (p.pendingElement > 0) openElementOffer(p, now);
    else if (p.pendingLevels > 0) openPerkOffer(ctx, p, now);
    return;
  }
  // (no "not in the same instant" guard: while the world is held for the
  // pick, `now` does not move, and an offer opened this tick returns above
  // before any choice could reach it anyway)
  // Langaren's bag runs on its own rules, and closes if he has gone (combat/langaren.ts)
  if (p.offer.kind === 'bag') {
    stepBag(ctx.run as unknown as Run, p, p.offer, now);
    return;
  }
  const choice = p.input.choice;
  if (choice === CHOICE.none) return;
  // the click that chose is still held next tick: it must not become a shot
  p.fireCdUntil = Math.max(p.fireCdUntil, now + 350);
  if (isSwapChoice(choice)) {
    const [i, j] = swapOf(choice);
    swapTickets(p, i, j);
    return;
  }
  if (p.offer.kind === 'element') resolveElement(ctx, p, p.offer, choice, now);
  else if (p.offer.kind === 'shop') resolveShop(ctx, p, p.offer, choice, now);
  else resolvePerk(ctx, p, p.offer, choice, now);
}

/**
 * The kiosk's shelf (core/cards.ts): three SL cards for this player, rolled
 * once per visit from the run's stream by tier weight, never one already
 * held. Three slots; a card is yours alone and sells back for half. The
 * shopper stands still while browsing and the world does not wait, the
 * station is cleared, and the dark is the clock.
 */
export function openShop(ctx: CombatHost, p: Player, now: number) {
  if (p.offer) return;
  // one shelf per station: rolled on the first visit to ANY of its kiosk
  // windows, and the same at every other, walking away and coming back is
  // not a reroll
  // ...and a function of the SEED and the STATION, not of everything that
  // happened on the way: the same seed used to stock a different shelf on
  // every run, because the roll drew from the run's one stream (from play
  // 2026-09-04)
  if (p.shelf === null) p.shelf = rollShelf(ctx.run.contentRng(`shop:${ctx.st.name}:${p.id}`), p.cards, 3);
  p.offer = { kind: 'shop', items: [...p.shelf], openedAt: now, canReroll: false };
}

function resolveShop(ctx: CombatHost, p: Player, offer: Offer, choice: number, now: number) {
  if (choice === CHOICE.skip) {
    p.offer = null;
    return;
  }
  const discount = kioskMul(p);
  if (choice >= CHOICE.sell(0) && choice < CHOICE.sell(3)) {
    const slot = choice - CHOICE.sell(0);
    const id = p.cards[slot];
    const t = id ? ticketById(id) : undefined;
    if (!t) return;
    withTickets(p, (ids) => ids.splice(slot, 1));
    p.money += ticketSellPrice(t);
    ctx.showMsg(`Sold ${t.title} (+${ticketSellPrice(t)} kr)`, now, p);
    return;
  }
  if (choice === CHOICE.upgrade) {
    const next = NEXT_TIER[p.cardTier];
    if (!next) return;
    const price = Math.round(TIER_INFO[next].price * discount);
    if (p.money < price) {
      ctx.showMsg(`${TIER_INFO[next].label}: ${price} kr, not enough.`, now, p);
      return;
    }
    p.money -= price;
    p.cardTier = next;
    ctx.showMsg(`${TIER_INFO[next].label}: ${slotsFor(next)} tickets (−${price} kr)`, now, p);
    return;
  }
  const id = offer.items[choice - 1];
  const t = id ? ticketById(id) : undefined;
  if (!t) return;
  const price = ticketPrice(t, discount);
  if (p.cards.length >= slotsFor(p.cardTier)) {
    ctx.showMsg('Your card is full: sell a ticket, or buy a bigger card.', now, p);
    return;
  }
  if (p.money < price) {
    ctx.showMsg(`${t.title}: ${price} kr, not enough.`, now, p);
    return;
  }
  p.money -= price;
  withTickets(p, (ids) => ids.splice(slotFor(ids, t.id), 0, t.id));
  ctx.showMsg(`${t.title}: loaded (−${price} kr)`, now, p);
  // the shelf keeps what is left, at every window, and an empty one closes
  if (p.shelf) p.shelf = p.shelf.filter((x) => x !== id);
  offer.items = offer.items.filter((x) => x !== id);
  if (offer.items.length === 0) p.offer = null;
}

/** a reorder, from the pause screen or anywhere: swap two ticket slots */
export function swapTickets(p: Player, i: number, j: number) {
  if (i === j || i >= p.cards.length || j >= p.cards.length) return;
  withTickets(p, (ids) => {
    const t = ids[i];
    ids[i] = ids[j];
    ids[j] = t;
  });
}

/** a big moment (party level 5 or 12): one pick from the lane pool (core/lanes.ts) */
function openElementOffer(p: Player, now: number) {
  p.pendingElement -= 1;
  const items = laneOffer(p);
  // every lane at its top: the moment is an ordinary pick instead
  if (items.length === 0) {
    p.pendingLevels += 1;
    return;
  }
  p.offer = { kind: 'element', items, openedAt: now, canReroll: false };
}

function openPerkOffer(ctx: CombatHost, p: Player, now: number) {
  p.pendingLevels -= 1;
  const canReroll = !p.rerollBlocked;
  p.rerollBlocked = false;
  // EVERY perk, capped ones included: a capped card is drawn, shown as MAX
  // and refused below, so the ceiling is visible (the user's call 2026-09-24)
  const pool = PERKS.slice();
  // THE Nth DRAW OF THIS SEAT, from the seed (sim/det.ts seedOf): two runs
  // of one seed offer the same cards however fast you levelled, and a
  // reroll is the next draw, so it is never the same four again
  const rng = ctx.run.contentRng(`perk:${p.id}:${p.perkDraws}`);
  p.perkDraws += 1;
  const items: string[] = [];
  while (items.length < 4 && pool.length > 0) {
    items.push(pool.splice(Math.floor(rng() * pool.length), 1)[0].id);
  }
  p.offer = { kind: 'perk', items, openedAt: now, canReroll };
}

function resolveElement(ctx: CombatHost, p: Player, offer: Offer, choice: number, now: number) {
  const item = offer.items[choice - 1];
  if (!item) return;
  ctx.showMsg(applyLanePick(p, item), now, p);
  p.iframesUntil = now + 900;
  p.offer = null;
}

function resolvePerk(ctx: CombatHost, p: Player, offer: Offer, choice: number, now: number) {
  if (choice === CHOICE.reroll) {
    if (!offer.canReroll) return;
    p.offer = null;
    p.rerollBlocked = true; // the fresh draw has no reroll of its own
    p.pendingLevels += 1;
    return;
  }
  if (choice === CHOICE.skip) {
    p.money += 25;
    p.offer = null;
    ctx.showMsg('Skipped the stall: +25 kr.', now, p);
    return;
  }
  const id = offer.items[choice - 1];
  const perk = id ? PERKS.find((pk) => pk.id === id) : undefined;
  if (!perk) return;
  // at its ceiling the card is a MAX marker, not a pick, the screen greys
  // it, and the sim refuses it whatever the screen showed
  if (perkMaxed(perk, p.mods)) return;
  // a level-up is free: money is for the kiosk's cards (§16, decided in chat)
  applyPerk(perk.id, p.mods);
  p.perkCounts.set(perk.id, (p.perkCounts.get(perk.id) ?? 0) + 1);
  ctx.showMsg(`Perk: ${perk.title}`, now, p);
  p.iframesUntil = now + 900;
  p.offer = null;
}
