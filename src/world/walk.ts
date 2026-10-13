import { asLeg, asStation, type Place } from '../sim/place.ts';
import { standInLeg, standOnStation, NOWHERE, type Standing } from './floor.ts';

/**
 * MOVING ON THE MAP.
 *
 * A body has one position, a point on the map (src/world/floor.ts), and
 * moving is moving that point. There is no room to be "in" and so no room to
 * leave: you walk off the end of a platform and the ground under you is the
 * tunnel's, because the tunnel's mouth IS the platform's end and both
 * describe the same ground.
 *
 * That is the whole of what used to be a crossing. No handover, no map
 * between frames, no sign per axis, nothing to apply the wrong way round.
 */

/** what is under this point, asking every room that could be near it */
export function standAt(rooms: Iterable<Place>, x: number, y: number): Standing {
  for (const pl of rooms) {
    const st = asStation(pl);
    if (st) {
      const on = standOnStation(st, x, y);
      if (on.kind !== 'none') return on;
      continue;
    }
    const leg = asLeg(pl);
    if (!leg) continue;
    const on = standInLeg(leg, x, y);
    if (on.kind !== 'none') return on;
  }
  return NOWHERE;
}

/**
 * One step across the map, held by whatever floor is there.
 *
 * A body that cannot go where it is pointed tries each axis alone before
 * giving up, so walking into a wall at an angle slides along it rather than
 * stopping dead, the same courtesy the platform's edges have always given,
 * now given by the ground itself.
 */
export function slide(
  rooms: Iterable<Place>,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number; at: Standing } {
  const full = standAt(rooms, x + dx, y + dy);
  if (full.kind !== 'none') return { x: x + dx, y: y + dy, at: full };
  const alongX = dx !== 0 ? standAt(rooms, x + dx, y) : NOWHERE;
  if (alongX.kind !== 'none') return { x: x + dx, y, at: alongX };
  const alongY = dy !== 0 ? standAt(rooms, x, y + dy) : NOWHERE;
  if (alongY.kind !== 'none') return { x, y: y + dy, at: alongY };
  return { x, y, at: standAt(rooms, x, y) };
}
