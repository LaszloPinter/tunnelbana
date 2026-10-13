import * as C from '../config.ts';
import { datan2, dcos, dist, dsin } from '../sim/det.ts';

/**
 * BIARCS: the shape of a bore between two platforms. Two circular arcs
 * meeting tangentially, each of constant curvature, so however far a
 * platform's axis points from the chord to the next station the turn is
 * spread evenly along the leg, a train's cars follow it a few degrees
 * apart instead of folding at a joint. Deterministic trig only (det.ts).
 */

export type Pt = { x: number; y: number };

const SAMPLE = C.M(6);

/**
 * The points of a biarc from `p0` (unit tangent `t0`) to `p1` (arriving on
 * unit tangent `t1`), sampled every SAMPLE px, endpoints excluded. With
 * equal handle lengths d the joint is the midpoint of the two handle ends,
 * and d solves |v - d(t0 + t1)| = 2d for the chord v.
 */
export function biarc(p0: Pt, t0: Pt, p1: Pt, t1: Pt): Pt[] {
  const v = { x: p1.x - p0.x, y: p1.y - p0.y };
  const sx = t0.x + t1.x;
  const sy = t0.y + t1.y;
  const dot = t0.x * t1.x + t0.y * t1.y;
  const vs = v.x * sx + v.y * sy;
  const vv = v.x * v.x + v.y * v.y;
  const a = 2 * dot - 2;
  let d: number;
  if (Math.abs(a) < 1e-9) d = vs > 1e-9 ? vv / (2 * vs) : Math.sqrt(vv) / 2;
  else {
    const disc = Math.max(0, vs * vs - a * vv);
    const r1 = (vs + Math.sqrt(disc)) / a;
    const r2 = (vs - Math.sqrt(disc)) / a;
    d = Math.max(r1, r2);
    if (d <= 0) d = Math.sqrt(vv) / 2;
  }
  const j = { x: (p0.x + d * t0.x + p1.x - d * t1.x) / 2, y: (p0.y + d * t0.y + p1.y - d * t1.y) / 2 };
  return [...arcPoints(p0, t0, j), j, ...arcPoints(j, tangentAt(p0, t0, j), p1)];
}

/** the tangent an arc from `p0` (tangent `t0`) has when it reaches `p1` */
function tangentAt(p0: Pt, t0: Pt, p1: Pt): Pt {
  const c = { x: p1.x - p0.x, y: p1.y - p0.y };
  const phi = 2 * datan2(t0.x * c.y - t0.y * c.x, t0.x * c.x + t0.y * c.y);
  return { x: t0.x * dcos(phi) - t0.y * dsin(phi), y: t0.x * dsin(phi) + t0.y * dcos(phi) };
}

/** points along the circular arc leaving `p0` on `t0` and reaching `p1`, endpoints excluded */
function arcPoints(p0: Pt, t0: Pt, p1: Pt): Pt[] {
  const c = { x: p1.x - p0.x, y: p1.y - p0.y };
  const chord = dist(c.x, c.y);
  if (chord < 1e-6) return [];
  const phi = 2 * datan2(t0.x * c.y - t0.y * c.x, t0.x * c.x + t0.y * c.y);
  const out: Pt[] = [];
  if (Math.abs(phi) < 1e-4) {
    const n = Math.max(1, Math.ceil(chord / SAMPLE));
    for (let i = 1; i < n; i++) out.push({ x: p0.x + (c.x * i) / n, y: p0.y + (c.y * i) / n });
    return out;
  }
  const r = chord / (2 * dsin(Math.abs(phi) / 2));
  const len = r * Math.abs(phi);
  // the centre is r to the left (phi > 0) or right of the start tangent
  const side = phi > 0 ? 1 : -1;
  const cx = p0.x - t0.y * r * side;
  const cy = p0.y + t0.x * r * side;
  const a0 = datan2(p0.y - cy, p0.x - cx);
  const n = Math.max(2, Math.ceil(len / SAMPLE));
  for (let i = 1; i < n; i++) {
    const ang = a0 + (phi * i) / n;
    out.push({ x: cx + r * dcos(ang), y: cy + r * dsin(ang) });
  }
  return out;
}
