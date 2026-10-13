import { asStation, type Place } from '../sim/place.ts';
import { onPlatform } from './floor.ts';

/**
 * WHERE THE THINGS IN A STATION'S PLAN ACTUALLY STAND.
 *
 * A plan says where a kiosk is the way a plan says anything: so far along the
 * platform, so far across it (sim/stationPlan.ts). That is the right language
 * for a plan and it is what the art is laid out from. A body on the map is
 * something else entirely, a point in Stockholm.
 *
 * Comparing the two never matches, at any station, ever: no machine, no
 * kiosk, no stair and no exit could be reached at all (from play 2026-09-11:
 * "kiosks don't work. I cannot shop or refill mana"). Rather than convert
 * every fixture, there are hundreds, and they belong to the plan, this
 * turns the ONE point being asked about back into the room's own terms, which
 * is the direction the conversion already exists in (world/floor.ts).
 */
export function inPlanTerms(st: Place, x: number, y: number): { x: number; y: number } {
  const station = asStation(st);
  if (!station) return { x, y };
  return onPlatform(station, x, y) ?? { x, y };
}

/** is this body within `reach` of any of these fixtures? */
export function nearFixture(
  st: Place,
  list: { x: number; y: number }[],
  x: number,
  y: number,
  reach: number,
): boolean {
  const at = inPlanTerms(st, x, y);
  for (const m of list) {
    const dx = m.x - at.x;
    const dy = m.y - at.y;
    if (dx * dx + dy * dy < reach * reach) return true;
  }
  return false;
}
