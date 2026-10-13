import { departuresFrom, type LineColor } from '../core/network.ts';
import { type Corridor } from '../core/corridor.ts';
import { corridorCarries, corridorKey } from '../core/tube.ts';

/**
 * A LEG AS A PLACE (§17): a player walking a tunnel has placeId
 * `leg:a#la|b#lb`, the two rooms it joins, names sorted, and coordinates
 * (s, t): arc length along the corridor's centreline and lateral across it.
 * These are the id helpers every module agrees on.
 */

/** one place per tube, whichever end you enter */
export function legIdOf(c: Corridor): string {
  return `leg:${corridorKey(c)}`;
}

export function isLeg(id: string): boolean {
  return id.startsWith('leg:');
}

/** the stock colour of a leg's traffic, it decides train lengths out there */
export function legColor(c: Corridor): LineColor {
  const runs = departuresFrom(c.a).find((d) => d.next === c.b && corridorCarries(c, d.service.id, d.dir));
  return runs?.service.color ?? 'green';
}

/**
 * THE SECRET VENDOR (asked in chat, carried over 2026-09-02): somebody is
 * trading out of the first recess at either end of the corridor between
 * Slussen and Medborgarplatsen. No shutters, no clearing requirement, the
 * platform kiosk opens when the station is safe; this one is open BECAUSE
 * nowhere in a tunnel is.
 */
export const VENDOR_LEG: readonly [string, string] = ['Slussen', 'Medborgarplatsen'];
