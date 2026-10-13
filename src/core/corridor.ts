import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { biarc } from './biarc.ts';
export {
  recessAt,
  recessBump,
  recessCentres,
  RECESS_DEPTH,
  RECESS_EVERY,
  RECESS_FIRST,
  RECESS_HALF,
  RECESS_SHOULDER,
} from './recess.ts';
import { legBetween } from '../data/legGeometry.ts';
import { ANCHOR_X, boreYOf, endSignF, frameOf, isWaterLeg, legLevel, toWorld } from './worldNet.ts';

/**
 * THE CORRIDOR: a leg as real geometry (split out of worldNet.ts).
 *
 * A centreline curve joining two platform ends, walls a fixed distance either
 * side, recesses cut into them every 90 m, and a lateral axis `t` across it.
 * Everything here is pure data and arithmetic off it, simulation-safe, trig
 * from sim/det.ts, no randomness.
 *
 * ---- the one sign convention ----
 *
 * `t` is the corridor tangent (a-end to b-end) rotated +90°. A station's local
 * +y is NOT that axis at both ends: at the a-end the corridor leaves along
 * +sa·axis, so local dy = sa·t; at the b-end it ARRIVES along -sb·axis, so
 * local dy = -sb·t. `corridorEndSign` is the one place that knows this. It was
 * assumed to be `sb` at the b-end, which mirrored every walker entering a leg
 * from its b station onto the other track (measured: 333 of 631 band exit
 * points unrolled onto the wrong side, scripts/probe/legsign.ts).
 */

/** the bore's cross-section, in px, the CROSS SECTION, as demanded */
export const BORE_GAUGE = C.M(2.6); // track centre from bore centreline
// The wall hugs the dynamic envelope: track at ±2.6 m, a car 3.4 m wide,
// pressed flat against the rock you are still inside a passing train's
// sweep, which is what makes the recesses matter. (A real bore has little
// more clearance than this, and nobody survives it standing either.)
export const BORE_WALL = C.M(4.4); // wall from bore centreline
/** how long a track takes to swing from its station band to the bore gauge */
export const BLEND_LEN = C.M(55);

export interface Corridor {
  /** sorted pair, the corridor is CANONICAL, one per leg */
  a: string;
  b: string;
  /**
   * THE STOREY IT JOINS AT EACH END. A corridor joins two ROOMS, not two
   * station names: T-Centralen runs one direction of the green and red lines
   * at level -2 and the other at -3, and the tube from Gamla stan into each
   * is a different tube, it lands on a different mouth, at a different
   * bearing, a flight apart. One corridor per station pair hung every
   * storey's traffic off the storey the first departure happened to use, so
   * a train that calls a flight down was drawn arriving through the hall
   * you stood in (from play 2026-09-13, and the last open item after it).
   */
  la: number;
  lb: number;
  /** which end of each platform it joins (geometric, per the leg's storey) */
  sa: 1 | -1;
  sb: 1 | -1;
  /** the bore's centre in each station's local y (worldNet.boreYOf): the
   * origin every lateral at that end is measured from */
  ya: number;
  yb: number;
  /** sampled centreline, a-end to b-end, extended a little past both mouths
   * so projections of nearby track ends never clamp to a corner */
  pts: { x: number; y: number }[];
  cum: number[];
  /** the unit tangent at each vertex, the mean of its two chords, so the
   * normal turns smoothly along the curve instead of stepping at every
   * vertex (a point 10 m off the centreline moved metres at each step) */
  tang: { x: number; y: number }[];
  length: number;
  /** arc marks of the TRUE platform mouths within the extended polyline */
  s0: number;
  s1: number;
  /** how covered this leg is: 1 is bored rock, 0 is open sky. Below 0.55 it
   * reads as a BRIDGE, water and railings instead of walls and recesses, a
   * continuous walkway refuge instead of alcoves. 0.55, not lower: Gamla
   * stan–Slussen measures 0.50 because it dives at one end, and that leg IS
   * the bridge over Söderström. `coverA/B`: the cover at each mouth. */
  cover: number;
  coverA: number;
  coverB: number;
  /** a real water crossing (isWaterLeg): water is drawn under it. An open
   * leg that is NOT water is a daylight embankment, not a bridge. */
  water: boolean;
}

/** how far a bore runs straight out of a platform before it may curve */
const RUN_OUT = C.M(45);
const corridors = new Map<string, Corridor>();

/**
 * The corridor between two rooms: `la0` is the storey at `a0`'s end and
 * `lb0` at `b0`'s. Left out, each end takes the storey the first departure
 * that way uses, which is the only storey at every station but the
 * stacked few, and the right one for a picture that has no service in mind.
 */
export function corridorOf(a0: string, b0: string, la0?: number, lb0?: number): Corridor | null {
  const swap = !(a0 < b0);
  const a = swap ? b0 : a0;
  const b = swap ? a0 : b0;
  const la = (swap ? lb0 : la0) ?? legLevel(a, b);
  const lb = (swap ? la0 : lb0) ?? legLevel(b, a);
  const key = `${a}#${la}|${b}#${lb}`;
  const hit = corridors.get(key);
  if (hit) return hit;
  const fa = frameOf(a, la);
  const fb = frameOf(b, lb);
  if (!fa || !fb) return null;
  const sa = endSignF(fa, b);
  const sb = endSignF(fb, a);
  const ya = boreYOf(a, la, b);
  const yb = boreYOf(b, lb, a);
  const p0 = toWorld(fa, ANCHOR_X + sa * fa.halfLen, ya);
  const p1 = toWorld(fb, ANCHOR_X + sb * fb.halfLen, yb);
  // outward along each platform's axis: the way a train leaves that mouth
  const oa = { x: fa.ux * sa, y: fa.uy * sa };
  const ob = { x: fb.ux * sb, y: fb.uy * sb };
  // A STRAIGHT RUN-OUT at each mouth before the curve begins. Bores leave a
  // platform straight, the points and crossovers are there, and it is
  // also what keeps the far tracks of a wide station honest: a track 10 m
  // off the centreline cannot follow a bend that turns 40° in ten metres,
  // which is what a curve starting AT the mouth did at Slussen (the offset
  // curve folded and a train's cars bunched, scripts/probe/worldview.ts).
  const chord = dist(p1.x - p0.x, p1.y - p0.y);
  const RUN = Math.min(RUN_OUT, chord / 4);
  const q0 = { x: p0.x + oa.x * RUN, y: p0.y + oa.y * RUN };
  const q1 = { x: p1.x + ob.x * RUN, y: p1.y + ob.y * RUN };
  // Between the run-outs the bore is a BIARC: two circular arcs meeting
  // tangentially, each of constant curvature, so however far a platform's
  // axis points from the chord to the next station the turn is spread
  // evenly along the leg. The cubic that was here put nearly all of it into
  // forty metres outside Slussen's mouth (56°, a 20 m car could not follow
  // it; worldview probe, 2026-09-03), because a Hermite bulges and then
  // corrects when its end tangents lean the same way off the chord.
  const arcs = biarc(q0, oa, q1, { x: -ob.x, y: -ob.y });
  const pts: { x: number; y: number }[] = [];
  const cum: number[] = [];
  const push = (q: { x: number; y: number }) => {
    const last = pts[pts.length - 1];
    cum.push(last ? cum[cum.length - 1] + dist(q.x - last.x, q.y - last.y) : 0);
    pts.push(q);
  };
  // a short straight run-in past each mouth (along the platform axis), so a
  // point a shade beyond the mouth still projects cleanly
  const EXT = C.M(40);
  push({ x: p0.x - oa.x * EXT, y: p0.y - oa.y * EXT });
  push(p0);
  push(q0);
  for (const q of arcs) push(q);
  push(q1);
  push(p1);
  const s1 = cum[cum.length - 1];
  push({ x: p1.x - ob.x * EXT, y: p1.y - ob.y * EXT });
  const leg = legBetween(a, b);
  const coverA = leg?.coverA ?? leg?.coverB ?? 1;
  const coverB = leg?.coverB ?? leg?.coverA ?? 1;
  const tang = vertexTangents(pts);
  const c: Corridor = {
    a,
    b,
    la,
    lb,
    sa,
    sb,
    ya,
    yb,
    pts,
    cum,
    tang,
    length: cum[cum.length - 1],
    s0: EXT,
    s1,
    cover: (coverA + coverB) / 2,
    coverA,
    coverB,
    water: isWaterLeg(a, b),
  };
  corridors.set(key, c);
  return c;
}

/** unit tangents at a polyline's vertices: the mean of the chords either side */
function vertexTangents(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  const chord = (i: number) => {
    const p = pts[i];
    const q = pts[i + 1];
    const len = Math.max(1e-9, dist(q.x - p.x, q.y - p.y));
    return { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  };
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const before = i > 0 ? chord(i - 1) : chord(i);
    const after = i + 1 < pts.length ? chord(i) : chord(i - 1);
    const mx = before.x + after.x;
    const my = before.y + after.y;
    const len = Math.max(1e-9, dist(mx, my));
    out.push({ x: mx / len, y: my / len });
  }
  return out;
}

/** the centreline point at arc length s from the a-end, with a tangent that
 * turns smoothly along the curve (interpolated between the vertices) */
export function corridorPos(c: Corridor, s: number): { x: number; y: number; tx: number; ty: number } {
  const ss = Math.max(0, Math.min(c.length, s));
  // binary search the sample the arc length falls in
  let lo = 0;
  let hi = c.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] <= ss) lo = mid;
    else hi = mid;
  }
  const seg = Math.max(1e-9, c.cum[hi] - c.cum[lo]);
  const f = (ss - c.cum[lo]) / seg;
  const p = c.pts[lo];
  const q = c.pts[hi];
  const ta = c.tang[lo];
  const tb = c.tang[hi];
  const mx = ta.x + (tb.x - ta.x) * f;
  const my = ta.y + (tb.y - ta.y) * f;
  const ml = Math.max(1e-9, dist(mx, my));
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, tx: mx / ml, ty: my / ml };
}

/**
 * Project a world point onto the corridor: s along it, t across it
 * (+t is the tangent rotated +90°, consistently), and the squared distance
 * to the centreline, cheap enough to ask every tick.
 */
export function corridorProject(c: Corridor, wx: number, wy: number): { s: number; t: number; d: number } {
  let best = Infinity;
  let bs = 0;
  let bt = 0;
  for (let i = 0; i + 1 < c.pts.length; i++) {
    const p = c.pts[i];
    const q = c.pts[i + 1];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const len2 = ex * ex + ey * ey;
    if (len2 < 1e-9) continue;
    let f = ((wx - p.x) * ex + (wy - p.y) * ey) / len2;
    f = Math.max(0, Math.min(1, f));
    const px = p.x + ex * f;
    const py = p.y + ey * f;
    const dd = (wx - px) * (wx - px) + (wy - py) * (wy - py);
    if (dd < best) {
      best = dd;
      const seg = Math.sqrt(len2);
      bs = c.cum[i] + seg * f;
      // +t = the tangent rotated +90°: n = (-ty, tx)
      bt = -(ey / seg) * (wx - px) + (ex / seg) * (wy - py);
    }
  }
  return { s: bs, t: bt, d: Math.sqrt(best) };
}

/**
 * IS THIS LEG IN THE OPEN? Only if it is open at BOTH mouths.
 *
 * `cover` is the MEAN of the two ends, and a leg that dives, covered where
 * it leaves one platform, out in daylight at the other, averaged to just
 * under the threshold and was drawn as open sky for its whole length, with
 * the gloom painting a dark patch over one end of it. Walking it read as a
 * dark tunnel that suddenly became bright, and then as a bright connection
 * from the other side, because a station's own chart drew the same leg from
 * the other mouth (from play 2026-09-06: "what is wrong with this game?").
 *
 * A leg with a covered end is a BORE that opens into daylight, which is what
 * the green line south of Gullmarsplan actually is; the gloom's own blend
 * from mouth to mouth is what makes it bright at the open end.
 */
export function legIsOpen(c: Corridor): boolean {
  // A BRIDGE is a bridge for its whole length even where it dives at one
  // end: Gamla stan–Slussen measures 0/1 and IS the Söderström crossing, so
  // a water leg keeps the mean. Everything else has to be open at both ends,
  // nine legs on the network read 1/0 and were sky the whole way.
  return c.water ? c.cover < 0.55 : Math.max(c.coverA, c.coverB) < 0.55;
}
