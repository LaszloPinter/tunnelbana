import * as C from '../config.ts';
import { machineMul } from '../core/cards.ts';
import { nearFixture } from '../world/fixtures.ts';
import { manaMax, maxHp, type Player } from '../sim/player.ts';
import type { CombatHost } from './types.ts';
import { asStation } from '../sim/place.ts';
import type { Station } from '../sim/station.ts';

/**
 * THE VENDING MACHINES: mana by the pack, health by the pack, at a price that
 * climbs. Running past one BUYS ON ITS OWN when you are under 60% and can pay
 * (autoBuy); casual players never found E (from play 2026-10-15: "the mana
 * machine doesn't do anything"). E still buys, at any level. The kiosk stays
 * E only: it is a choice, not a top-up.
 */
export function tryBuy(ctx: CombatHost, p: Player, now: number) {
  // a machine stands on a platform; a bore has none
  const st = asStation(ctx.st);
  if (!st) return;
  // a machine is placed in the STATION'S own plan; a body is a point on the
  // map (src/world/fixtures.ts)
  const near = (list: { x: number; y: number }[]) => nearFixture(ctx.st, list, p.x, p.y, C.M(2));
  if (near(ctx.st.manaMachines)) buyMana(ctx, st, p, now, false);
  else if (near(ctx.st.healthMachines)) buyHealth(ctx, p, now, false);
  else if (ctx.run.tutorial) {
    // the lesson: E means something only where there is something
    ctx.showMsg('Nothing to use here: walk to the marked MANA machine.', now, p);
  }
}

/** below this share of the bar, walking past a machine buys */
export const AUTO_BUY_BELOW = 0.6;
const AUTO_BUY_REST_MS = 1500;

/** every tick, for a seat on a platform: a machine in reach tops them up */
export function autoBuy(ctx: CombatHost, p: Player, now: number) {
  if (now < p.autoBuyAt || p.frame.kind !== 'world' || !p.alive || p.downed) return;
  const st = asStation(ctx.st);
  if (!st) return;
  const near = (list: { x: number; y: number }[]) => nearFixture(ctx.st, list, p.x, p.y, C.M(2));
  let bought = false;
  if (p.mana < manaMax(ctx.run.party, p) * AUTO_BUY_BELOW && near(ctx.st.manaMachines))
    bought = buyMana(ctx, st, p, now, true);
  else if (p.health < maxHp(p) * AUTO_BUY_BELOW && near(ctx.st.healthMachines))
    bought = buyHealth(ctx, p, now, true);
  // a rest after each pack: a short wallet is not emptied in one pass
  if (bought) p.autoBuyAt = now + AUTO_BUY_REST_MS;
}

/** a mana pack or a few; quiet (auto) says nothing when it cannot buy */
function buyMana(ctx: CombatHost, st: Station, p: Player, now: number, quiet: boolean): boolean {
  const mMax = manaMax(ctx.run.party, p);
  if (p.mana >= mMax) {
    if (!quiet) ctx.showMsg('Mana already full.', now, p);
    return false;
  }
  // the price climbs with every purchase at this station, the machine
  // "runs low"; riding to the next station resets it
  const packPrice = Math.round((20 + st.manaBuysHere * 15) * machineMul(p));
  if (p.money < packPrice) {
    if (!quiet) ctx.showMsg(`MANA: ${packPrice} kr/pack, not enough money.`, now, p);
    return false;
  }
  const perPack = 42;
  const fit = Math.ceil((mMax - p.mana) / perPack);
  const packs = Math.max(1, Math.min(Math.floor(p.money / 2 / packPrice), fit));
  const cost = packs * packPrice;
  p.money -= cost;
  p.mana = Math.min(mMax, p.mana + packs * perPack);
  st.manaBuysHere += 1;
  ctx.showMsg(
    `+${packs * perPack} mana (−${cost} kr) · next pack ${20 + st.manaBuysHere * 15} kr here`,
    now,
    p,
  );
  return true;
}

function buyHealth(ctx: CombatHost, p: Player, now: number, quiet: boolean): boolean {
  const missing = maxHp(p) - p.health;
  if (missing <= 0) {
    if (!quiet) ctx.showMsg('Already at full health.', now, p);
    return false;
  }
  const hpPrice = Math.round(30 * machineMul(p));
  if (p.money < hpPrice) {
    if (!quiet) ctx.showMsg(`HEALTH: ${hpPrice} kr/pack, not enough money.`, now, p);
    return false;
  }
  const packs = Math.min(Math.ceil(missing / 40), Math.floor(p.money / hpPrice));
  const cost = packs * hpPrice;
  p.money -= cost;
  p.health = Math.min(maxHp(p), p.health + packs * 40);
  ctx.showMsg(`+${packs * 40} HP (−${cost} kr)`, now, p);
  return true;
}
