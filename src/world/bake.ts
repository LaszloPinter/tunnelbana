import { corridorPos } from '../core/corridor.ts';
import * as C from '../config.ts';
import { asLeg, asStation, type Place } from '../sim/place.ts';
import { fromPlatform } from './floor.ts';
import type { Leg } from '../sim/legPlace.ts';
import type { Station } from '../sim/station.ts';
import type { Box } from '../sim/stationPlan.ts';
import { dist } from '../sim/det.ts';

/**
 * THE MAP, BAKED FLAT.
 *
 * The walkable world as one set of world-space quads, and nothing else. No
 * room owns a coordinate system; no point has to be projected onto a curve or
 * turned into a platform's along-and-across to find out what it is standing
 * on. A patch of floor is four corners on the map, and the question "what is
 * here" is answered by looking.
 *
 * This is the last of the frame-thinking gone. Even after bodies moved onto
 * the map, the ROOMS still described themselves in their own measures and the
 * map delegated to them, which meant asking a bore to project a point back
 * onto its centreline, and that projection is only exact for a point ON the
 * centreline: sixteen metres off it, on the sharpest bend in the network, the
 * arc came back 1.58 m out and a point plainly inside the tunnel could be
 * reported as rock. Baking removes the question rather than tightening the
 * tolerance.
 *
 * Cutting the result into chunks is then what it should always have been: a
 * way to draw and search less, not a way to decide what anything means.
 */

export type Ground = 'platform' | 'bed' | 'bore';
/** what stands ON the floor and will not let a body through */
export type Solid = 'pillar' | 'bench';

export interface Patch {
  kind: Ground | Solid;
  /** the place this floor belongs to, for the rules that are still a
   * station's or a tunnel's business: its trains, its waves, its alcoves */
  place: Place;
  /** on a platform: which island. On a bed: which rail. Otherwise -1 */
  index: number;
  /** four corners, in order round the quad */
  x: [number, number, number, number];
  y: [number, number, number, number];
  /** its bounding box, for the grid and for a cheap reject */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * HOW FINELY a bore's curve is cut into straight patches.
 *
 * A patch is a flat trapezium between two cross-sections, so its long edges
 * are chords of the tunnel's true walls, and a chord cuts the corner. That
 * error grows with how far the wall is from the centreline, and these walls
 * are up to sixteen metres out, so the cut has to be finer than the bend.
 * Measured against the walls themselves (probe `baked`): three-metre pieces
 * leave 268 points of real tunnel floor outside the baked map, two-metre 154,
 * one-metre none. A leg is then a few hundred patches, which the grid
 * (src/world/chunks.ts) answers in a handful of tests.
 */
const BORE_STEP = C.M(1);

/** how close to an edge still counts as on it: a hundredth of a pixel, far
 * below anything the game can express and far above the rounding */
const EDGE = 0.01;

function quad(kind: Ground | Solid, place: Place, index: number, pts: { x: number; y: number }[]): Patch {
  const xs = pts.map((p) => p.x) as [number, number, number, number];
  const ys = pts.map((p) => p.y) as [number, number, number, number];
  return {
    kind,
    place,
    index,
    x: xs,
    y: ys,
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

/** what a body cannot walk through, baked flat like the floor is: the roof
 * columns and the benches, at the bearing their platform stands at */
export function bakeSolids(st: Station): Patch[] {
  const out: Patch[] = [];
  const box = (kind: Solid, b: Box) =>
    out.push(
      quad(kind, st, -1, [
        fromPlatform(st, b.x0, b.y0),
        fromPlatform(st, b.x1, b.y0),
        fromPlatform(st, b.x1, b.y1),
        fromPlatform(st, b.x0, b.y1),
      ]),
    );
  for (const b of st.pillars) box('pillar', b);
  for (const b of st.benches) box('bench', b);
  return out;
}

/** a platform's floor: its islands, and the track beds a body may stand on */
export function bakeStation(st: Station): Patch[] {
  const out: Patch[] = [];
  const x0 = st.platformX0;
  const x1 = st.platformX1;
  const strip = (kind: Ground, index: number, top: number, bottom: number) =>
    out.push(
      quad(kind, st, index, [
        fromPlatform(st, x0, top),
        fromPlatform(st, x1, top),
        fromPlatform(st, x1, bottom),
        fromPlatform(st, x0, bottom),
      ]),
    );
  st.platforms.forEach((pf, i) => strip('platform', i, pf.top, pf.bottom));
  st.rails.forEach((rl, i) => strip('bed', i, rl.bandTop, rl.bandBottom));
  return out;
}

/** a bore's floor: the ribbon between its walls, cut into straight pieces */
export function bakeLeg(leg: Leg): Patch[] {
  const c = leg.cor;
  const out: Patch[] = [];
  const edge = (s: number) => {
    const p = corridorPos(c, s);
    const b = leg.arcBand(s);
    return {
      top: { x: p.x - p.ty * b.top, y: p.y + p.tx * b.top },
      bottom: { x: p.x - p.ty * b.bottom, y: p.y + p.tx * b.bottom },
    };
  };
  let a = edge(c.s0);
  for (let s = c.s0 + BORE_STEP; s < c.s1 + BORE_STEP; s += BORE_STEP) {
    const to = Math.min(s, c.s1);
    const b = edge(to);
    out.push(quad('bore', leg, -1, [a.top, b.top, b.bottom, a.bottom]));
    a = b;
    if (to >= c.s1) break;
  }
  return out;
}

/** everything walkable in these rooms, as flat patches on the map */
export function bakeFloor(rooms: Iterable<Place>): Patch[] {
  const out: Patch[] = [];
  for (const pl of rooms) {
    const st = asStation(pl);
    if (st) {
      out.push(...bakeStation(st), ...bakeSolids(st));
      continue;
    }
    const leg = asLeg(pl);
    if (leg) out.push(...bakeLeg(leg));
  }
  return out;
}

/**
 * Is this point inside the quad? The corners go round it, so the point is
 * inside when it is on the same side of all four edges. A baked bore piece is
 * a trapezium and a platform strip a rectangle; both are convex, which is the
 * whole reason for cutting curves into pieces rather than carrying them.
 */
export function inPatch(p: Patch, x: number, y: number): boolean {
  if (x < p.x0 - EDGE || x > p.x1 + EDGE || y < p.y0 - EDGE || y > p.y1 + EDGE) return false;
  let neg = false;
  let pos = false;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3;
    const ex = p.x[j] - p.x[i];
    const ey = p.y[j] - p.y[i];
    // the SIGNED DISTANCE from the edge, not the raw cross product: a point
    // on the edge gives zero either way, but the cross product's zero is a
    // number the size of the patch and rounding pushes it to whichever side
    // it likes. Every patch meets its neighbour along a shared edge, so
    // points ON an edge are not a corner case here, they are the seam
    // between two pieces of the same floor, and a body walking the middle of
    // a bore lands on one every four metres.
    const len = dist(ex, ey) || 1;
    const d = (ex * (y - p.y[i]) - ey * (x - p.x[i])) / len;
    if (d < -EDGE) neg = true;
    else if (d > EDGE) pos = true;
    if (neg && pos) return false;
  }
  return true;
}
