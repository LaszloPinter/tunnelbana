import { defaultMods } from '../core/mods.ts';
import { applyPerk } from '../core/perks.ts';
import { laneMods, type LaneId } from '../core/lanes.ts';
import { applyTickets } from '../core/cards.ts';
import type { Player } from './player.ts';

/**
 * A PLAYER'S NUMBERS, REBUILT FROM WHAT THEY HOLD: the perks they picked
 * (by count), the lanes they took (in the order they took them), and the
 * tickets on their card. Mods are otherwise carried as derived state,
 * mutated pick by pick; this is the one place that says the derivation
 * out loud, what §19 needs for a seat handed between groups, and what the
 * lab needs to swap a lane in and out (ui/dom/lab.ts).
 */
export function rebuildMods(p: Player): void {
  const m = defaultMods();
  for (const [id, n] of p.perkCounts) for (let i = 0; i < n; i++) applyPerk(id, m);
  for (const id of p.laneOrder) if (p.lanes[id] > 0) laneMods(m, id, p.lanes[id]);
  p.mods = m;
  applyTickets(p, 1);
}

/** set a lane to a tier (0 takes it away), keeping the order it was taken in */
export function setLane(p: Player, id: LaneId, tier: number): void {
  const had = p.lanes[id] > 0;
  p.lanes[id] = tier;
  if (tier > 0 && !had) p.laneOrder.push(id);
  if (tier === 0) p.laneOrder = p.laneOrder.filter((l) => l !== id);
  rebuildMods(p);
}
