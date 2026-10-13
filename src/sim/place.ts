import type { Platform, Rail } from '../core/world.ts';
import type { Box, StationPlan } from './stationPlan.ts';
import type { PlatformPath } from '../core/platformPath.ts';
import type { AcidPool, Boarding, Enemy, Loot, Proj, Strike } from '../combat/types.ts';

/**
 * A PLACE (§17). The world is a chain, station, tunnel, station, tunnel, and
 * both links in it are the same kind of thing: a room with a floor, walls, an
 * id, and whatever is standing in it.
 *
 * A leg used to be a coordinate convention rather than a place: a walker's
 * position was kept twice (once as corridor arc, once as the unrolled view of
 * it in whichever station they had entered by), the mobs out there belonged to
 * that station, and every system that asked a question about a tunnel got a
 * platform's answer. Five separate bugs came out of that in one play session
 * (2026-09-06), an invisible train, a train that appeared beside you, shots
 * that passed through, a horde that queued on a leash, a tunnel drawn as
 * daylight. They were symptoms of one thing: there was no such place.
 *
 * ---- the one frame ----
 *
 * Every place is a flat (x, y) room, and that is what lets the horde, the
 * bolts, the loot and the shields work in a tunnel without knowing they are in
 * one. A station's x runs along its platform. A LEG's x is arc length along
 * the bore's centreline and its y is the lateral across it, so a leg is simply
 * a very long, very thin room. Nothing is unrolled and nothing is kept twice.
 *
 * ---- the degenerate half ----
 *
 * A leg has no islands, no rails, no furniture and no waves. It answers those
 * with empty arrays and −1 rather than making every caller ask what kind of
 * place it is: the empty answer is the TRUE answer, and code that walks a
 * platform's edges simply finds none out in the rock. Where behaviour really
 * does differ, the walls, whether a train can stand here, ask `kind`.
 */
export type PlaceKind = 'station' | 'leg';

/** the walls of a place at a given x: a band of open floor between them */
export interface Band {
  top: number;
  bottom: number;
}

export interface Place {
  readonly kind: PlaceKind;
  /** `st:Name` or `leg:A|B`, its identity in the place graph */
  readonly id: string;
  /** what to call it on screen */
  readonly name: string;

  // ---- the floor: what is standing in this room ----
  enemies: Enemy[];
  projs: Proj[];
  coins: Loot[];
  pickups: Loot[];
  stains: Loot[];
  acidPools: AcidPool[];
  strikes: Strike[];
  boardings: Boarding[];

  // ---- the room ----
  /** the walkable x span: a platform's ends, or a leg's two mouths */
  readonly x0: number;
  readonly x1: number;
  /** the outermost y this room reaches, for clamping */
  worldTopY: number;
  worldBottomY: number;
  /**
   * The walls at this x, the band of floor between them. A station answers
   * for the bores off its ends and null over the platform itself (where the
   * islands and beds decide instead); a leg always answers, because the bore
   * is all there is.
   */
  bandAt(x: number): Band | null;
  /** the picture's curve: the sim stays straight, a station's picture bends */
  worldY(x: number, y: number): number;
  pathYAt(x: number, wy: number): number;
  pathOffsetAt(x: number): number;
  drawAngle(x: number, dx: number, dy: number): number;

  // ---- the station half, degenerate in a leg ----
  rails: Rail[];
  platforms: Platform[];
  pillars: Box[];
  benches: Box[];
  passages: { x0: number; x1: number }[];
  escalators: { x: number; y: number }[];
  shafts: { x: number; y: number; w: number; h: number; delta: -1 | 1 }[];
  manaMachines: { x: number; y: number }[];
  healthMachines: { x: number; y: number }[];
  kiosks: { x: number; y: number }[];
  platformX0: number;
  platformX1: number;
  levelIndex: number;
  plan: StationPlan | null;
  path: PlatformPath;
  platformAt(y: number): number;
  railBedAt(y: number): number;
  pillarAt(x: number, y: number, r: number): boolean;
  inTunnelX(x: number, r?: number): boolean;

  // ---- what is happening here ----
  /** a station: its waves are done. A leg: its ambush has sprung. */
  cleared: boolean;
  corruption: number;
  /** this place's own random stream, never the run's shared one (§17) */
  readonly rng: () => number;
  /** bumped by a re-lay; the picture rebuilds when it changes */
  buildGen: number;
}

/**
 * THE STATION HALF OF THE GRAPH, where a train can stand, null out in a
 * tunnel. Everything that is really about a platform (its waves, its boards,
 * its rides, its kiosk, its storeys) asks for this rather than assuming the
 * place it was handed has islands.
 */
export function asStation(pl: Place | null | undefined): import('./station.ts').Station | null {
  return pl && pl.kind === 'station' ? (pl as import('./station.ts').Station) : null;
}

/** ...and the tunnel half: a bore between two platforms */
export function asLeg(pl: Place | null | undefined): import('./legPlace.ts').Leg | null {
  return pl && pl.kind === 'leg' ? (pl as import('./legPlace.ts').Leg) : null;
}
