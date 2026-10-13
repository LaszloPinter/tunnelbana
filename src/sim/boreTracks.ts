import { corridorLateral } from '../core/linePath.ts';
import { usesOf } from '../core/corridorTraffic.ts';
import { corridorCarries } from '../core/tube.ts';
import type { Leg } from './legPlace.ts';

/**
 * EVERY DISTINCT TRACK THROUGH A BORE, the leg-frame lateral of each at
 * arc s. In the leg's own frame the bore's centre IS zero and the lateral
 * needs no mouth sign: `t` is the corridor's own axis (core/corridor.ts).
 *
 * Two things this has to get right, both of which it once got wrong:
 *
 * ONLY THIS TUBE'S TRACKS, by the SAME RULE THE TRAFFIC USES. A corridor is
 * one object per pair of stations, but a stacked station is several rooms one
 * above another and the line paths hang every storey's services off that one
 * corridor. `boreTraffic` has always filtered the trains by storey
 * (sim/bore.ts); the rails did not, so a bore could paint a rail belonging to
 * a tunnel a flight below it with no train ever on it. Both now ask
 * `serviceLegLevel`, which is the property worth having: whatever runs here
 * is drawn here, and nothing else is.
 *
 * ONE LINE IS ONE TRACK. Tracks that share a band the whole way (17/18/19)
 * are one line, and a line is always the same track along its length, so it
 * can never jump between two, hence the dedupe on the lateral's shape
 * rather than on the service.
 */
export function boreTracks(leg: Leg): ((s: number) => number)[] {
  const c = leg.cor;
  const seen = new Set<string>();
  const out: ((s: number) => number)[] = [];
  for (const use of usesOf(c)) {
    if (!corridorCarries(c, use.serviceId, use.dir)) continue;
    const p = use.piece;
    const key = `${p.tIn.toFixed(1)}|${p.tBore.toFixed(1)}|${p.tOut.toFixed(1)}|${p.sB >= p.sA}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dir = p.sB >= p.sA ? 1 : -1;
    out.push((s: number) => corridorLateral(p, Math.max(0, Math.min(p.len, (s - p.sA) * dir))));
  }
  return out;
}
