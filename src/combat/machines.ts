import * as C from '../config.ts';
import { machineMul } from '../core/cards.ts';
import { nearFixture } from '../world/fixtures.ts';
import { manaMax, maxHp, type Player } from '../sim/player.ts';
import type { CombatHost } from './types.ts';
import { asStation } from '../sim/place.ts';

/** the vending machines: mana by the pack, health by the pack, at a price that climbs */
export function tryBuy(ctx: CombatHost, p: Player, now: number) {
  // a machine stands on a platform; a bore has none
  const st = asStation(ctx.st);
  if (!st) return;
  // a machine is placed in the STATION'S own plan; a body is a point on the
  // map (src/world/fixtures.ts)
  const near = (list: { x: number; y: number }[]) => nearFixture(ctx.st, list, p.x, p.y, C.M(2));
  if (near(ctx.st.manaMachines)) {
    const mMax = manaMax(ctx.run.party, p);
    if (p.mana >= mMax) {
      ctx.showMsg('Mana already full.', now, p);
      return;
    }
    // the price climbs with every purchase at this station, the machine
    // "runs low"; riding to the next station resets it
    const packPrice = Math.round((20 + st.manaBuysHere * 15) * machineMul(p));
    if (p.money < packPrice) {
      ctx.showMsg(`MANA: ${packPrice} kr/pack, not enough money.`, now, p);
      return;
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
  } else if (near(ctx.st.healthMachines)) {
    const missing = maxHp(p) - p.health;
    if (missing <= 0) {
      ctx.showMsg('Already at full health.', now, p);
      return;
    }
    const hpPrice = Math.round(30 * machineMul(p));
    if (p.money < hpPrice) {
      ctx.showMsg(`HEALTH: ${hpPrice} kr/pack, not enough money.`, now, p);
      return;
    }
    const packs = Math.min(Math.ceil(missing / 40), Math.floor(p.money / hpPrice));
    const cost = packs * hpPrice;
    p.money -= cost;
    p.health = Math.min(maxHp(p), p.health + packs * 40);
    ctx.showMsg(`+${packs * 40} HP (−${cost} kr)`, now, p);
  } else if (ctx.run.tutorial) {
    // the lesson: E means something only where there is something
    ctx.showMsg('Nothing to use here: walk to the marked MANA machine and press E there.', now, p);
  }
}
