import { corridorPos, corridorProject, type Corridor } from '../core/corridor.ts';
import { frameOf, toLocal, toWorld, type WFrame } from '../core/worldNet.ts';
import * as C from '../config.ts';
import { asLeg, asStation, type Place } from '../sim/place.ts';
import type { Leg } from '../sim/legPlace.ts';
import type { Station } from '../sim/station.ts';

/**
 * THE WORLD, IN TWO DIMENSIONS, ONCE.
 *
 * Stockholm's metro is a map, not a line. Its stations stand at real places
 * with real bearings and its tunnels are curves, measured over this network,
 * 98 of 100 bores bend more than 2% past the straight line between their
 * mouths, median 1.18x, worst 1.55x. Two routes between the same pair of
 * stations therefore have different lengths, and that is not a contradiction:
 * there is one Fridhemsplan, and the green line simply takes the long way to
 * T-Centralen.
 *
 * The game used to unroll each room into its own straight frame and map
 * between them at every boundary. That is where every tunnel bug came from,
 * a room's coordinates read in another room's frame, and it can never be
 * made consistent globally, because a curved graph does not flatten onto a
 * line. So there is no unrolling here and no frames to map between. A body
 * has ONE position: a point on the map.
 *
 * A room's own parameterisation still exists, a platform's along-and-across,
 * a bore's arc-and-lateral, but only to describe that room's SHAPE. Nothing
 * is ever stored in it.
 */

/** how far off a bore's centreline anything can be before it is certainly
 * not in the tunnel, a cheap reject before projecting onto the polyline */
const BORE_REACH = C.M(40);

/**
 * THE MOUTH BELONGS TO BOTH. A bore's mouth and its platform's end are the
 * same ground described twice, measured over the network they meet to
 * 0.000 m, the worst overshoot being nine thousandths of a pixel, so a point
 * exactly on that line lands on whichever side the arithmetic rounds to.
 * Without this, 48 of 74,029 points along the bores had nothing underfoot,
 * every one of them exactly at a mouth. A twentieth of a pixel is far below
 * anything the game can express and far above the rounding.
 */
const SEAM_EPS = 0.05;

export interface Standing {
  kind: 'platform' | 'bed' | 'bore' | 'none';
  place: Station | Leg | null;
  /** on a platform: which island. On a bed: which rail. Otherwise -1 */
  index: number;
  /** the room's own description of the point: along and across */
  s: number;
  t: number;
}

export const NOWHERE: Standing = { kind: 'none', place: null, index: -1, s: 0, t: 0 };

/** where a platform stands on the map, and which way it faces */
export function stationFrame(st: Station): WFrame | undefined {
  return frameOf(st.name, st.levelIndex);
}

/** a point of the world, said in a platform's own along-and-across */
export function onPlatform(st: Station, wx: number, wy: number): { x: number; y: number } | null {
  const f = stationFrame(st);
  return f ? toLocal(f, wx, wy) : null;
}

/** ...and back onto the map */
export function fromPlatform(st: Station, lx: number, ly: number): { x: number; y: number } {
  const f = stationFrame(st);
  return f ? toWorld(f, lx, ly) : { x: lx, y: ly };
}

/** is this point on a platform's floor, an island, or a bed a body may
 * stand on, and which? */
export function standOnStation(st: Station, wx: number, wy: number): Standing {
  const at = onPlatform(st, wx, wy);
  if (!at) return NOWHERE;
  if (at.x < st.platformX0 - SEAM_EPS || at.x > st.platformX1 + SEAM_EPS) return NOWHERE;
  const island = st.platformAt(at.y);
  if (island >= 0) return { kind: 'platform', place: st, index: island, s: at.x, t: at.y };
  const bed = st.railBedAt(at.y);
  if (bed >= 0) return { kind: 'bed', place: st, index: bed, s: at.x, t: at.y };
  return NOWHERE;
}

/** ...and is it inside a bore, between its walls? */
export function standInLeg(leg: Leg, wx: number, wy: number): Standing {
  const c: Corridor = leg.cor;
  const near = corridorProject(c, wx, wy);
  if (Math.abs(near.t) > BORE_REACH) return NOWHERE;
  // only between the mouths: past them is the platform's business
  if (near.s < c.s0 - SEAM_EPS || near.s > c.s1 + SEAM_EPS) return NOWHERE;
  // THE ARC IS SLIGHTLY BLURRED ON A BEND. Projecting a point onto a curve
  // is exact only for a point on the curve: far off the centreline the
  // normals converge, and the arc comes back up to 1.58 m out at 16 m
  // off-centre on the sharpest bore in the network (Gamla stan|Slussen,
  // measured over 24,500 points; the lateral is good to 0.26 m). Where the
  // bore is opening out to meet a platform the walls move fast with the arc,
  // so that blur is enough to put a point just inside the rock just outside
  // the band. Take the widest the wall is within the blur: it can only ever
  // admit ground the tunnel really has, and a body's own radius keeps it
  // clear of the wall anyway.
  const band = widestBand(leg, near.s);
  if (near.t < band.top || near.t > band.bottom) return NOWHERE;
  return { kind: 'bore', place: leg, index: -1, s: near.s, t: near.t };
}

/** how far the projected arc can be out, on the worst bend in the network */
const ARC_BLUR = C.M(2);

/** the widest the bore is within the arc's own uncertainty */
function widestBand(leg: Leg, s: number): { top: number; bottom: number } {
  const a = leg.arcBand(s);
  const b = leg.arcBand(s - ARC_BLUR);
  const c = leg.arcBand(s + ARC_BLUR);
  return {
    top: Math.min(a.top, b.top, c.top),
    bottom: Math.max(a.bottom, b.bottom, c.bottom),
  };
}

/** a point of a bore's own arc-and-lateral, put back on the map. `+t` is the
 * tangent turned a quarter left, the same way `corridorProject` measures it,
 * so the two are exact inverses */
export function fromLeg(leg: Leg, s: number, t: number): { x: number; y: number } {
  const p = corridorPos(leg.cor, s);
  return { x: p.x - p.ty * t, y: p.y + p.tx * t };
}

/** a point named in a room's own measure, said on the map */
export function intoWorld(pl: Place, x: number, y: number): { x: number; y: number } {
  const st = asStation(pl);
  if (st) return fromPlatform(st, x, y);
  const leg = asLeg(pl);
  return leg ? fromLeg(leg, x, y) : { x, y };
}
