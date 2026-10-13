import { SERVICES } from './network.ts';
import { bandOfService, stationBands, type BandTrack } from './stationLayout.ts';
import { BORE_GAUGE, BORE_WALL, corridorOf, type Corridor } from './corridor.ts';
import { corridorCarries, corridorKey, corridorMouth } from './tube.ts';

/**
 * THE TRACKS IN A BORE: which platform band each service's direction leaves
 * a station on, the slot it runs at inside the bore, one each, in the
 * order they leave the platform, so tracks can never cross, and how wide
 * the bore has to be for them.
 */

/**
 * The band a service's direction uses at one end of this corridor. Through
 * stations have one; a stub TERMINUS lists the service on both platforms,
 * and the one that keeps the train on the side its band is at the
 * neighbouring station is the one it physically uses, trains arrive on
 * one platform and, having turned, depart from the other, left-hand running
 * both ways. (The sim alternates the platforms by journey; the picture
 * blends an arriving train onto whichever it was given.)
 */
export function bandForCorridor(
  c: Corridor,
  station: string,
  serviceId: string,
  dir: 1 | -1,
): { levelIndex: number; track: BandTrack } | null {
  const first = bandOfService(station, serviceId, dir);
  if (!first) return null;
  const all = stationBands(station, first.levelIndex).tracks;
  const tracks = all.filter((t) => t.services.includes(serviceId));
  // A TERMINATING ARRIVAL WITH NO PLATFORM OF ITS OWN runs in on whichever
  // track carries its direction of travel, as the realised rails have it
  // (sim/journeyBand.ts). The plan lists a service only where it departs:
  // a 17 ending at Åkeshov is listed on the eastbound platform alone, and
  // laid there its westbound arrival stood in the path of every eastbound
  // 19 pulling in (probe overlap2d, 2026-09-21).
  const svc = SERVICES.find((s) => s.id === serviceId);
  if (svc) {
    const head = svc.stations[0] === station;
    const tail = svc.stations[svc.stations.length - 1] === station;
    const arriving = (head && dir === -1) || (tail && dir === 1);
    if (arriving && !tracks.some((t) => t.dir === dir)) {
      const byDir = all.filter((t) => t.dir === dir);
      if (byDir.length > 0) return { levelIndex: first.levelIndex, track: byDir[0] };
    }
  }
  // a through station has ONE track for this direction. A stub terminus
  // lists its departures on both platforms and its arrivals on neither, so
  // there the platform is chosen by continuity
  const exact = tracks.filter((t) => t.dir === dir);
  if (exact.length === 1) return { levelIndex: first.levelIndex, track: exact[0] };
  const candidates = exact.length > 1 ? exact : tracks;
  if (candidates.length < 2) return first;
  // AT A TERMINUS WITH TWO TRACKS, ONE ARRIVES AND ONE DEPARTS. Chosen by
  // continuity both directions landed on the same track, and a departure
  // emerged onto the platform while the last arrival still stood there
  // (probe sametrack, Kungsträdgården, when the trains got faster). The
  // realised rails choose the same way (sim/journeyBand.ts terminusTrack).
  const split = terminusTrack(tracks, station, serviceId, dir);
  if (split) return { levelIndex: first.levelIndex, track: split };
  const other = station === c.a ? c.b : c.a;
  const there = bandOfService(other, serviceId, dir);
  if (!there) return first;
  const lateral = (st: string, li: number, t: BandTrack) => {
    const m = corridorMouth(c, st, li);
    return ((t.bandTop + t.bandBottom) / 2 - m.y) * m.sign;
  };
  const want = lateral(other, there.levelIndex, there.track);
  let best = first.track;
  let bd = Infinity;
  for (const t of candidates) {
    const d = Math.abs(lateral(station, first.levelIndex, t) - want);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return { levelIndex: first.levelIndex, track: best };
}

/**
 * AT AN END OF THE ROUTE WITH TWO TRACKS, ONE ARRIVES AND ONE DEPARTS, and
 * WHICH is which is geometry, not order. The two directions run the bore in
 * an order (core/boreSlots.ts boreSlotsOf: the order their bands have at the
 * through station), and the two platforms are taken in THAT order, so the
 * fan out over the points never crosses: the direction on the high side of
 * the bore gets the high platform. Chosen nearest-first instead, the 10 into
 * Kungsträdgården took the platform beside the bore and the 10 out had to
 * cross it from the far one, an X in the tunnel (from play 2026-09-17;
 * probe railcross). Null away from a route's ends.
 */
export function terminusTrack(
  tracks: BandTrack[],
  station: string,
  serviceId: string,
  dir: 1 | -1,
): BandTrack | null {
  if (tracks.length < 2) return null;
  const svc = SERVICES.find((s) => s.id === serviceId);
  if (!svc) return null;
  const head = svc.stations[0] === station;
  const tail = svc.stations[svc.stations.length - 1] === station;
  if (!head && !tail) return null;
  const arriving: 1 | -1 = head ? -1 : 1;
  const departing: 1 | -1 = head ? 1 : -1;
  const neighbour = head ? svc.stations[1] : svc.stations[svc.stations.length - 2];
  const c = neighbour ? corridorOf(station, neighbour) : null;
  const inBand = c ? bandOfService(neighbour, serviceId, arriving) : null;
  const outBand = c ? bandOfService(neighbour, serviceId, departing) : null;
  const lateral = (st: string, lv: number, t: BandTrack) => {
    const m = corridorMouth(c!, st, lv);
    return ((t.bandTop + t.bandBottom) / 2 - m.y) * m.sign;
  };
  const li =
    (bandOfService(station, serviceId, arriving) ?? bandOfService(station, serviceId, dir))?.levelIndex ?? 0;
  // A COLOUR'S SERVICES SHARE A TERMINUS. Kungsträdgården's plan gives the
  // 10 and the 11 an island each, on opposite sides of the bore they share,
  // so whichever platforms each took, one service's arrival crossed the
  // other's departure over the points. Both use the pair of platforms
  // nearest the bore, one each way, like the real station's two tracks.
  const pool = c ? stationBands(station, li).tracks.filter((t) => t.color === svc.color) : tracks;
  const cands = pool.length >= 2 ? pool : tracks;
  const byLateral = c ? [...cands].sort((p, q) => lateral(station, li, p) - lateral(station, li, q)) : cands;
  const nearest = (want: number, among: BandTrack[]): BandTrack => {
    let best = among[0];
    let bd = Infinity;
    for (const t of among) {
      const d = Math.abs(lateral(station, li, t) - want);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };
  let arrival = byLateral[byLateral.length - 1];
  if (c && inBand && outBand) {
    const wantIn = lateral(neighbour, inBand.levelIndex, inBand.track);
    const wantOut = lateral(neighbour, outBand.levelIndex, outBand.track);
    if (cands.length > 2) {
      // more platforms than the bore has tracks: the two nearest its own
      arrival = nearest(wantIn, byLateral);
      const departure = nearest(
        wantOut,
        byLateral.filter((t) => t !== arrival),
      );
      return dir === arriving ? arrival : departure;
    }
    arrival = wantIn > wantOut ? byLateral[byLateral.length - 1] : byLateral[0];
  } else if (c && inBand) {
    arrival = nearest(lateral(neighbour, inBand.levelIndex, inBand.track), byLateral);
  }
  if (dir === arriving) return arrival;
  return byLateral.find((t) => t !== arrival) ?? cands[0];
}

const slotCache = new Map<string, Map<string, number>>();

/**
 * Which lateral each (service, direction) runs at inside this bore. Tracks
 * keep the ORDER they have across the platform they leave: sorted by their
 * band's lateral at the entry mouth, they take slots a track gauge apart
 * either side of the centreline, two tracks at ±BORE_GAUGE, four (the
 * green–red trunk) at ±1 and ±3 gauges. Tracks that share a band (17/18/19)
 * share a slot. Ordered slots are what make crossing impossible: a track
 * can only reach the other side by changing its order, and it never does.
 */
function boreSlotsOf(c: Corridor): Map<string, number> {
  const key = corridorKey(c);
  const hit = slotCache.get(key);
  if (hit) return hit;
  // every track's lateral at BOTH mouths, in the corridor's frame
  const entries: { id: string; ta: number; tb: number }[] = [];
  const lateralAt = (station: string, svcId: string, dir: 1 | -1): number | null => {
    const band = bandForCorridor(c, station, svcId, dir);
    if (!band) return null;
    const m = corridorMouth(c, station, band.levelIndex);
    return ((band.track.bandTop + band.track.bandBottom) / 2 - m.y) * m.sign;
  };
  for (const svc of SERVICES) {
    for (let i = 0; i + 1 < svc.stations.length; i++) {
      const x = svc.stations[i];
      const y = svc.stations[i + 1];
      if (!((x === c.a && y === c.b) || (x === c.b && y === c.a))) continue;
      for (const dir of [1, -1] as const) {
        // only what runs THIS tube: at a stacked station the other
        // direction leaves by another tube a flight away
        if (!corridorCarries(c, svc.id, dir)) continue;
        const ta = lateralAt(c.a, svc.id, dir);
        const tb = lateralAt(c.b, svc.id, dir);
        if (ta === null || tb === null) continue;
        entries.push({ id: `${svc.id}:${dir}`, ta, tb });
      }
    }
  }
  // HOW MANY TRACKS THE BORE HAS. Between two through stations it is the
  // number of distinct (lateral here, lateral there) pairs, never one
  // mouth alone, because T-Centralen stacks its storeys and two different
  // tracks share a local y there. Toward a TERMINUS it is the through
  // station's count alone: a terminus lays its platforms per LINE (10 on
  // one island, 11 on the other at Kungsträdgården) and fans the bore's two
  // tracks, one per DIRECTION, out to them over the points, so counting
  // its laterals made a two-track bore four wide with two on the centreline
  // (2026-09-03). Order is taken the same way; entries that share the lead
  // lateral share a slot.
  const near = (p: number, q: number) => Math.abs(p - q) < 0.5;
  const terminus = (st: string) =>
    SERVICES.some((svc) => {
      const i = svc.stations.indexOf(st);
      const other = st === c.a ? c.b : c.a;
      const adjacent = i >= 0 && (svc.stations[i - 1] === other || svc.stations[i + 1] === other);
      return adjacent && (i === 0 || i === svc.stations.length - 1);
    });
  const termA = terminus(c.a);
  const termB = terminus(c.b);
  type Lead = { ta: number; tb: number };
  const leadOf = (e: Lead): Lead =>
    termA !== termB ? (termB ? { ta: e.ta, tb: e.ta } : { ta: e.tb, tb: e.tb }) : e;
  const same = (p: Lead, q: Lead) => near(p.ta, q.ta) && near(p.tb, q.tb);
  const distinct: Lead[] = [];
  for (const e of entries) {
    const l = leadOf(e);
    if (!distinct.some((d) => same(d, l))) distinct.push(l);
  }
  distinct.sort((p, q) => (near(p.ta, q.ta) ? p.tb - q.tb : p.ta - q.ta));
  const n = distinct.length;
  const out = new Map<string, number>();
  for (const e of entries) {
    const rank = distinct.findIndex((d) => same(d, leadOf(e)));
    // two tracks close to the gauge; a wider section (the green–red trunk,
    // four abreast) keeps each track near where both its stations lay it,
    // and where two of them swap places between the stations (the braid
    // out of Slussen) the piece is drawn as a crossover the whole leg long
    // (linePath corridorLateral, `wide`)
    out.set(e.id, n <= 2 ? (rank - (n - 1) / 2) * 2 * BORE_GAUGE : (e.ta + e.tb) / 2);
  }
  wideCache.set(key, n > 2);
  slotCache.set(key, out);
  return out;
}

const wideCache = new Map<string, boolean>();

/** more than two tracks abreast: each keeps its own lateral the whole way */
export function isWideBore(c: Corridor): boolean {
  boreSlotsOf(c);
  return wideCache.get(corridorKey(c)) ?? false;
}

export function boreLateralOf(c: Corridor, serviceId: string, dir: 1 | -1): number {
  return boreSlotsOf(c).get(`${serviceId}:${dir}`) ?? (dir === 1 ? BORE_GAUGE : -BORE_GAUGE);
}

/** the bore's half-width: the outermost track plus the clearance a two-track bore has */
export function boreWallOf(c: Corridor): number {
  let outer = BORE_GAUGE;
  for (const t of boreSlotsOf(c).values()) outer = Math.max(outer, Math.abs(t));
  return outer + (BORE_WALL - BORE_GAUGE);
}
