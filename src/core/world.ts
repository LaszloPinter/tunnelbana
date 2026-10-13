import type { Departure, LineColor } from './network.ts';
import type { Train } from './train.ts';

/**
 * The reference frames everything in the station lives in, and the two pieces
 * of station structure (a track and an island) that the rest of the game asks
 * questions of. A station is N platforms x N rails; a curved station will
 * change what these mean geometrically, not who holds them.
 */

/** where the player is: on the ground or inside a car */
export type Frame = { kind: 'world' } | { kind: 'aboard'; ti: number; rx: number; ry: number; jid?: string };

/** everything else only ever stands on the ground or rides inside a car */
export type EntityFrame =
  | { kind: 'world' }
  | {
      kind: 'aboard';
      ti: number;
      rx: number;
      ry: number;
      /**
       * THE TRAIN, not the track it happens to be standing on. A rail is a
       * slot at one station and the fleet reassigns it the moment its train
       * leaves, so a rider named by (station, rail) is a rider whose seat
       * belongs to whatever pulls in next. On the map a seat is on a JOURNEY,
       * and it stays on it through the tunnel and into the next station.
       */
      jid?: string;
    };

/** one track: every service of one colour running one way through here */
export interface Rail {
  train: Train;
  /** index into the pre-allocated per-rail graphics arrays */
  slot: number;
  color: LineColor;
  /** +1 = toward the end of the service's station list */
  dir: 1 | -1;
  /** the fleet journey realised on this track right now, or null (§18) */
  journey?: string | null;
  /** the services that use this track, and where each one goes next */
  options: Departure[];
  /** which option the train currently standing/arriving here is running */
  current: Departure;
  /** is that train a kort tåg, two units instead of three? */
  short: boolean;
  /** platform edge y this rail serves */
  edgeY: number;
  /** from that edge toward the platform interior */
  inward: 1 | -1;
  /** the y-band of open track bed that belongs to this rail */
  bandTop: number;
  bandBottom: number;
}

/** an island platform: a walkable strip with a rail along each edge */
export interface Platform {
  top: number;
  bottom: number;
  /** the line this island serves, it decides how the station was dug, and so
   * whether it has a row of pillars holding the roof up */
  color: LineColor;
  /** rail index serving the top / bottom edge */
  railTop: number;
  railBottom: number;
}
