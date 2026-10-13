import * as C from '../config.ts';
import type { Corridor } from './corridor.ts';
import { corridorKey } from './corridorId.ts';

/**
 * THE RECESSES: the alcoves cut into a bore's wall every ninety metres,
 * where a walker stands down while a train goes by. One profile, used by
 * the simulation's collision and by the picture alike (src/render/tunnelArt.ts).
 */

export const RECESS_EVERY = C.M(90);
export const RECESS_FIRST = C.M(45);
export const RECESS_HALF = C.M(3); // half the mouth
export const RECESS_DEPTH = C.M(4);

/** is arc position s inside a recess mouth? (both walls carry one),
 * measured from the TRUE mouths, not the extended polyline ends */
export function recessAt(c: Corridor, s: number): boolean {
  if (c.cover < 0.55) return false;
  const d = s - c.s0;
  const span = c.s1 - c.s0;
  if (d < RECESS_FIRST - RECESS_HALF || d > span - (RECESS_FIRST - RECESS_HALF)) return false;
  const k = (d - RECESS_FIRST) % RECESS_EVERY;
  const near = k < RECESS_HALF || k > RECESS_EVERY - RECESS_HALF;
  if (!near) return false;
  const idx = Math.round((d - RECESS_FIRST) / RECESS_EVERY);
  const centre = RECESS_FIRST + idx * RECESS_EVERY;
  return centre > RECESS_FIRST - 1 && centre < span - RECESS_FIRST + 1;
}

/**
 * HOW DEEP the wall is cut at arc `s`: 0 out on the bore, RECESS_DEPTH
 * inside an alcove, a smooth shoulder between. The picture draws this
 * profile and the walker is clamped to it, so the wall you see is the wall
 * you touch, the collision was a bare rectangle while the drawing had
 * curved shoulders (from play 2026-09-04).
 */
export const RECESS_SHOULDER = C.M(1.5);
export function recessBump(c: Corridor, s: number): number {
  let best = 0;
  for (const centre of recessCentres(c)) {
    const off = Math.abs(s - centre);
    if (off >= RECESS_HALF + RECESS_SHOULDER) continue;
    const f = Math.max(0, Math.min(1, (RECESS_HALF + RECESS_SHOULDER - off) / (2 * RECESS_SHOULDER)));
    best = Math.max(best, RECESS_DEPTH * f * f * (3 - 2 * f));
  }
  return best;
}

/** every recess centre s on this corridor, for the picture */
const centreCache = new Map<string, number[]>();
export function recessCentres(c: Corridor): number[] {
  const key = corridorKey(c);
  const hit = centreCache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  if (c.cover < 0.55) return out;
  for (let s = c.s0 + RECESS_FIRST; s <= c.s1 - RECESS_FIRST; s += RECESS_EVERY) out.push(s);
  centreCache.set(key, out);
  return out;
}
