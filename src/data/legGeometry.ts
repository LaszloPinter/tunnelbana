import raw from '../../data/legs.json' with { type: 'json' };

/**
 * How far the real line turns between two adjacent stations, from the
 * difference between their platforms' bearings
 * (data/legs.json, © OpenStreetMap contributors, ODbL).
 *
 * The tunnels between stations are drawn from this: legs that really swing,
 * Fridhemsplan→Stadshagen at 87°, Globen's loop, Hötorget→T-Centralen, get a
 * tunnel that sweeps, and the six legs that run straight get a straight one.
 */
export interface Leg {
  /** degrees the line turns across this leg; sign is the direction */
  turnDeg: number;
  /** straight-line distance between the two stations, metres */
  distM: number;
  /** how covered the track is leaving THIS station toward the other: 0 is open
   * sky, 1 is tunnel. A leg with 0 at one end and 1 at the other is one that
   * dives on the way, which is most of what makes a ride feel like Stockholm */
  coverA: number | null;
  coverB: number | null;
}

const legs = (raw as { legs: Record<string, Leg> }).legs;

export const legBetween = (from: string, to: string): Leg | undefined =>
  legs[`${from}|${to}`];
