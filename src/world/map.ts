import { asLeg, asStation, type Place } from '../sim/place.ts';
import { onPlatform, standInLeg, standOnStation, NOWHERE, type Standing } from './floor.ts';
import type { Station } from '../sim/station.ts';

/**
 * THE MAP, AS THE SIMULATION ASKS IT.
 *
 * Every question here takes a point ON THE MAP and answers for whatever room
 * that point is in. The rooms still describe their own shapes in their own
 * along-and-across, a platform's islands are bands across it, a bore's walls
 * are an offset from its centreline, but that is a fact about the shape, and
 * it is converted here, once, at the moment of asking.
 *
 * This is the whole difference from what came before. The old world stored
 * every body in the coordinates of the room it happened to be in, so every
 * question had to be asked in the right frame and every crossing had to
 * change one set of numbers into another. Ask about a POINT and there is no
 * frame to get wrong: a body's position means the same thing everywhere,
 * which is what makes a tunnel and a platform one world instead of two.
 */
export class WorldMap {
  /** the rooms in play, a station and the bores off it, and their far
   * platforms. Kept small because only what a body can reach matters. */
  readonly rooms: Place[];

  constructor(rooms: Place[]) {
    this.rooms = rooms;
  }

  /** what is under this point: an island, a track bed, a bore, or nothing */
  standAt(x: number, y: number): Standing {
    for (const pl of this.rooms) {
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

  /** the station whose FRAME this point falls in, if any, which is not the
   * same as standing on its floor: a body in the air over the tracks, or in
   * the gap between two islands, is still at that station */
  stationAt(x: number, y: number): Station | null {
    for (const pl of this.rooms) {
      const st = asStation(pl);
      if (!st) continue;
      const at = onPlatform(st, x, y);
      if (!at) continue;
      if (at.x < st.platformX0 || at.x > st.platformX1) continue;
      if (at.y < st.worldTopY || at.y > st.worldBottomY) continue;
      return st;
    }
    return null;
  }

  /** which island this point is on, and at which station, or -1 */
  platformAt(x: number, y: number): number {
    const on = this.standAt(x, y);
    return on.kind === 'platform' ? on.index : -1;
  }

  /** ...and which track bed */
  railBedAt(x: number, y: number): number {
    const on = this.standAt(x, y);
    return on.kind === 'bed' ? on.index : -1;
  }

  /** is a roof column standing here? Columns belong to a platform, so this
   * asks the station whose frame the point is in */
  pillarAt(x: number, y: number, r: number): boolean {
    const st = this.stationAt(x, y);
    if (!st) return false;
    const at = onPlatform(st, x, y);
    return !!at && st.pillarAt(at.x, at.y, r);
  }

  /** ...and a bench */
  benchAt(x: number, y: number, r: number): boolean {
    const st = this.stationAt(x, y);
    if (!st) return false;
    const at = onPlatform(st, x, y);
    return (
      !!at && st.benches.some((b) => at.x > b.x0 - r && at.x < b.x1 + r && at.y > b.y0 - r && at.y < b.y1 + r)
    );
  }

  /** is this point out in a tunnel rather than on a platform? */
  inTunnel(x: number, y: number): boolean {
    return this.standAt(x, y).kind === 'bore';
  }
}
