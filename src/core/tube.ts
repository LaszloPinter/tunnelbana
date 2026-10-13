import { corridorOf, corridorPos, type Corridor } from './corridor.ts';
import { SERVICES } from './network.ts';
import { corridorKey } from './corridorId.ts';
export { corridorKey } from './corridorId.ts';
import { endSignF, frameOf, legLevel, toLocal } from './worldNet.ts';
import { bandOfService } from './stationLayout.ts';

/**
 * A TUBE: which corridor a service runs, which storey it joins at each end,
 * and its mouths, split out of corridor.ts, which builds the curve itself.
 *
 * A corridor joins two ROOMS. At a stacked station each direction has its
 * own hall and its own tube into it (T-Centralen: level -2 one way, -3 the
 * other), so "the corridor between two stations" is not one thing there, and
 * asking for it by names alone hung a train on a tube a flight from the hall
 * it calls at (2026-09-13).
 */

/** THE TUBE A SERVICE RUNS between two neighbouring stations, in this
 * direction: the corridor joining the storeys it calls at on each side */
export function corridorFor(a: string, b: string, serviceId: string, dir: 1 | -1): Corridor | null {
  const la = bandOfService(a, serviceId, dir)?.levelIndex ?? legLevel(a, b);
  const lb = bandOfService(b, serviceId, dir)?.levelIndex ?? legLevel(b, a);
  return corridorOf(a, b, la, lb);
}

/** the storey this corridor joins `station` at */
export function corridorLevelAt(c: Corridor, station: string): number {
  return station === c.a ? c.la : c.lb;
}

/** does this service, this way, run THIS tube, i.e. call at the storeys it
 * joins on both sides? The one rule for a bore's traffic, its rails and
 * its picture, so they can never disagree about what runs in it */
/** the line colours whose services run this corridor, memoised */
const colourCache = new Map<string, Set<string>>();
export function corridorColours(c: Corridor): Set<string> {
  const key = corridorKey(c);
  const hit = colourCache.get(key);
  if (hit) return hit;
  const out = new Set<string>();
  for (const svc of SERVICES) {
    for (let i = 0; i + 1 < svc.stations.length; i++) {
      const x = svc.stations[i];
      const y = svc.stations[i + 1];
      if ((x === c.a && y === c.b) || (x === c.b && y === c.a)) out.add(svc.color);
    }
  }
  colourCache.set(key, out);
  return out;
}

export function corridorCarries(c: Corridor, serviceId: string, dir: 1 | -1): boolean {
  const la = bandOfService(c.a, serviceId, dir)?.levelIndex ?? legLevel(c.a, c.b);
  const lb = bandOfService(c.b, serviceId, dir)?.levelIndex ?? legLevel(c.b, c.a);
  return la === c.la && lb === c.lb;
}

export interface MouthFrame {
  /** arc of the mouth on the corridor, and which way arc grows walking away from it */
  s: number;
  ds: 1 | -1;
  /** which physical end of THIS storey's platform the bore joins */
  e: 1 | -1;
  /** the bore centreline's local y at the mouth, in this storey's frame */
  y: number;
  /** local dy = sign * t, in this storey's frame */
  sign: 1 | -1;
}

const mouthCache = new Map<string, MouthFrame>();

/**
 * A corridor's mouth AS A GIVEN STOREY SEES IT. A bore is built on the
 * storey the leg's departures use, but a stacked station presents another
 * storey to the same bore, at T-Centralen trains toward Hötorget leave from
 * level -2 and trains from Hötorget arrive on level -3, whose axis points
 * the other way. So the end, the origin and the sign are worked out in the
 * asking storey's own frame: the end from geometry, the origin as the
 * corridor's mouth point in local coordinates, and the sign from which way
 * that frame's +y falls against the corridor's normal.
 */

export function corridorMouth(c: Corridor, station: string, levelIndex?: number): MouthFrame {
  const other = station === c.a ? c.b : c.a;
  const li = levelIndex ?? corridorLevelAt(c, station);
  const key = `${corridorKey(c)}|${station}#${li}`;
  const hit = mouthCache.get(key);
  if (hit) return hit;
  const atA = station === c.a;
  const s = atA ? c.s0 : c.s1;
  const q = corridorPos(c, s);
  const f = frameOf(station, li) ?? frameOf(station, legLevel(station, other))!;
  const e = endSignF(f, other);
  // the corridor's normal (+t) is its a->b tangent turned +90°; local +y is
  // the frame's axis turned +90°
  const nx = -q.ty;
  const ny = q.tx;
  const sign: 1 | -1 = nx * -f.uy + ny * f.ux >= 0 ? 1 : -1;
  const m: MouthFrame = { s, ds: atA ? 1 : -1, e, y: toLocal(f, q.x, q.y).y, sign };
  mouthCache.set(key, m);
  return m;
}

/** the sign that turns a corridor lateral into local dy at a storey's mouth */
export function corridorEndSign(c: Corridor, station: string, levelIndex?: number): 1 | -1 {
  return corridorMouth(c, station, levelIndex).sign;
}

/**
 * Corridor (s, t) in a station's local axes, that station being one of the
 * corridor's two ends: arc keeps its exact meaning, the curve is straightened
 * for display. `mouthX` is the local x of the platform end the leg joins.
 */
export function unrollCorridor(
  c: Corridor,
  station: string,
  mouthX: number,
  s: number,
  t: number,
  levelIndex?: number,
): { x: number; y: number } {
  const m = corridorMouth(c, station, levelIndex);
  const d = (s - m.s) * m.ds;
  return { x: mouthX + m.e * d, y: m.y + m.sign * t };
}

/** the inverse: local (x, y) of a station's view back into corridor (s, t) */
export function rollCorridor(
  c: Corridor,
  station: string,
  mouthX: number,
  x: number,
  y: number,
  levelIndex?: number,
): { s: number; t: number } {
  const m = corridorMouth(c, station, levelIndex);
  const d = (x - mouthX) * m.e;
  return { s: m.s + d * m.ds, t: (y - m.y) * m.sign };
}
