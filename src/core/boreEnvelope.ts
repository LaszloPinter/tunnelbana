import * as C from '../config.ts';
import { type Corridor } from './corridor.ts';
import { corridorKey, corridorLevelAt, corridorMouth } from './tube.ts';
import { usesOf } from './corridorTraffic.ts';
import { corridorLateral } from './linePath.ts';
import { stationBands } from './stationLayout.ts';

/**
 * HOW WIDE THE BORE HAS TO BE TO HOLD ITS OWN TRACKS, at each point along
 * it.
 *
 * A track swings from the band it leaves the platform on to its slot in the
 * bore, and that swing is a real crossover, the further it has to move the
 * longer it takes (linePath.corridorLateral, about 1:7). The WALL widened
 * toward the mouth on a fixed 55 m blend instead, so wherever a band sat
 * more than about eight metres off the bore's centre the track swung wider
 * than the tunnel drawn around it, and a train ran along outside the wall
 * (from play 2026-09-05: "it comes through the tunnel wall").
 *
 * Sampled once per corridor and cached: the answer is a property of the
 * line's geometry and never changes within a run.
 */
const STEP = C.M(5);
const cache = new Map<string, number[]>();

function envelope(c: Corridor): number[] {
  const key = corridorKey(c);
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.max(2, Math.ceil((c.s1 - c.s0) / STEP) + 1);
  const vals = new Array<number>(n).fill(0);
  for (const use of usesOf(c)) {
    const p = use.piece;
    const dir = p.sB >= p.sA ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const s = c.s0 + i * STEP;
      const d = Math.max(0, Math.min(p.len, (s - p.sA) * dir));
      vals[i] = Math.max(vals[i], Math.abs(corridorLateral(p, d)));
    }
  }
  cache.set(key, vals);
  return vals;
}

/** the widest any track runs at arc `s`, in the corridor's own frame */
export function boreEnvelopeAt(c: Corridor, s: number): number {
  const vals = envelope(c);
  const f = (s - c.s0) / STEP;
  const i = Math.max(0, Math.min(vals.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return vals[i] * (1 - t) + vals[i + 1] * t;
}

/**
 * HOW LONG THE WALL MUST TAKE TO CLOSE at one end of a corridor. A train
 * blends in from the band it actually stands at, which at a stacked or
 * wide station is a long way off the bore's centre, and that crossover is
 * about 1:7. The wall used a fixed 55 m whatever the station, so a train
 * leaving a far band was outside it for the first eighty metres.
 */
const blendCache = new Map<string, number>();
export function mouthBlendOf(c: Corridor, station: string): number {
  const key = `${corridorKey(c)}|${station}`;
  const hit = blendCache.get(key);
  if (hit !== undefined) return hit;
  const li = corridorLevelAt(c, station);
  const m = corridorMouth(c, station, li);
  let span = 0;
  for (const t of stationBands(station, li).tracks)
    span = Math.max(span, Math.abs(((t.bandTop + t.bandBottom) / 2 - m.y) * m.sign));
  const blend = Math.max(C.M(55), span * 7);
  blendCache.set(key, blend);
  return blend;
}
