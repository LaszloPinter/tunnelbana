import * as C from '../config.ts';
import { bandOfService, stationBands } from './stationLayout.ts';
import { SERVICES, type Service } from './network.ts';
import { legBetween } from '../data/legGeometry.ts';
import { linePathOf } from './linePath.ts';

/**
 * THE TIMETABLE AS ARITHMETIC: how long a leg takes, how often a service
 * runs, and when each service's k-th departure leaves, spaced so the
 * services sharing a trunk take it in turn and never stand in each other.
 */

/** the stations this journey calls at, in the order it calls at them */
export function routeOf(service: Service, dir: 1 | -1): string[] {
  return dir === 1 ? service.stations : [...service.stations].reverse();
}

/** how long a train takes to cover `metres`, standing start to full stop */
export function rideTimeFor(metres: number): number {
  const a = C.TRAIN_ACCEL;
  const v = C.TRAIN_CRUISE;
  const px = C.M(metres);
  const tA = v / a;
  const dA = a * tA * tA; // both ramps together
  if (px <= dA) return 2 * Math.sqrt(px / a);
  return 2 * tA + (px - dA) / v;
}

/**
 * How far apart two stations are, in metres, as the GAME lays them out: the
 * real OpenStreetMap distance scaled by `C.LEG_SCALE`. Every leg keeps its
 * length relative to every other, this is the one function that decides it,
 * so the walk, the ride and the drawing cannot disagree.
 */
export function legMetres(a: string, b: string): number {
  return (legBetween(a, b)?.distM ?? 800) * C.LEG_SCALE;
}

/** how long a turnback takes at the aligned terminus: unload, run into the
 * siding, change ends, run back out, sized so an arriving train's metal IS
 * the very next opposite departure (journeyMotion.turnsInto) and the whole
 * cycle fits a two-track terminus inside the headway */
export const TURNBACK_MS = 80_000;

/** the station every service of every colour calls at: where the trunk's
 * traffic is spaced */
const TRUNK_REF = 'T-Centralen';

/**
 * The least a shared track can take between two trains: a 15 s dwell, ~16 s
 * for a 140 m train to clear the platform from a standing start, and a beat
 * for the next one's braking approach. Closer than this and the arriving
 * train stands in the departing one (which it did, at 20 s: the "colliding"
 * trains of 2026-09-03).
 */
export const MIN_TRACK_GAP_MS = 48_000;

/**
 * A service's headway: the configured one, unless the services sharing its
 * colour's trunk would then run closer than the track can carry, three
 * green services at 60 s would be a train every 20 s through T-Centralen.
 */
export function headwayOf(service: Service): number {
  const key = service.color;
  const hit = headwayCache.get(key);
  if (hit !== undefined) return hit;
  const group = SERVICES.filter((s) => s.color === service.color);
  let floor = group.length * MIN_TRACK_GAP_MS;
  // A ONE-TRACK TERMINUS holds each train from arrival to departure: the
  // next may not nose in until the last has turned and cleared. Norsborg,
  // Fruängen and Mörby centrum are laid out that way, and at 96 s the
  // arrival ran in 8 m behind the departure (sametrack probe, 2026-09-03).
  // Every service of the colour shares the floor: the trunk is spaced by
  // interleaving them evenly, which only works at one common headway.
  for (const s of group)
    for (const end of [s.stations[0], s.stations[s.stations.length - 1]])
      if (terminusTracks(end, s.id) === 1) floor = Math.max(floor, TURNBACK_MS + MIN_TRACK_GAP_MS);
  const h = Math.max(C.HEADWAY_MS, floor);
  headwayCache.set(key, h);
  return h;
}

const headwayCache = new Map<string, number>();

/**
 * How many tracks a service can stand on at one of its ends: the ones that
 * list it, and the one carrying its ARRIVING direction where another service
 * runs through, a 17 ending at Åkeshov runs in on the 19s' westbound
 * platform and departs from the eastbound one, which is two tracks, not the
 * one the plan lists it on. Counted as one, it was held at a signal in the
 * tunnel for a platform that was never busy, with the next 19 running into
 * its back (probe sametrack, 2026-09-21).
 */
export function terminusTracks(station: string, service: string): number {
  const svc = SERVICES.find((s) => s.id === service);
  const lvl =
    bandOfService(station, service, 1)?.levelIndex ?? bandOfService(station, service, -1)?.levelIndex ?? 0;
  const tracks = stationBands(station, lvl).tracks;
  const listed = tracks.filter((tr) => tr.services.includes(service));
  if (!svc) return listed.length;
  const head = svc.stations[0] === station;
  const tail = svc.stations[svc.stations.length - 1] === station;
  if (!head && !tail) return listed.length;
  const arriving: 1 | -1 = head ? -1 : 1;
  const usable = new Set(listed);
  for (const tr of tracks) if (tr.dir === arriving) usable.add(tr);
  return usable.size;
}

/**
 * Stop times of a journey RELATIVE to its origin departure: the standard
 * profile's time over each leg's real track arc (the line path's own
 * stop-to-stop distance), so the schedule is physically drivable by
 * construction. Cached per (service, direction).
 */
const relCache = new Map<string, { station: string; arriveAt: number }[]>();
export function relativeStops(service: Service, dir: 1 | -1): { station: string; arriveAt: number }[] {
  const key = `${service.id}:${dir}`;
  const hit = relCache.get(key);
  if (hit) return hit;
  const route = routeOf(service, dir);
  const path = linePathOf(service.id, dir);
  const out: { station: string; arriveAt: number }[] = [];
  let t = 0;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) {
      t +=
        rideTimeFor(
          path ? (path.stopS[i] - path.stopS[i - 1]) / C.PX_PER_M : legMetres(route[i - 1], route[i]),
        ) * 1000;
      t += C.DWELL_MS;
    }
    out.push({ station: route[i], arriveAt: t });
  }
  relCache.set(key, out);
  return out;
}

/**
 * SERVICES THAT SHARE A TRACK ARE INTERLEAVED. The three green services run
 * the same trunk, and so do the two red and the two blue: if each left its
 * terminus on its own epoch, two of them could reach a shared platform at
 * the same moment, and did, which put two trains on one track at once (the
 * ghost trains, 2026-09-03). So a colour's services are spaced evenly at the
 * one station they all call at: the k-th of n arrives at T-Centralen k/n of
 * a headway after the first, in each direction. Every service keeps its own
 * headway; the trunk sees them in turn. Pure arithmetic on the schedule, so
 * four clients agree without a word.
 */
/** the two directions of a colour are offset by this much of a headway, so
 * that where a branch crosses the trunk on the flat the two never meet */
export const DIR_PHASE = 0.0625;
const epochCache = new Map<string, number>();
export function epochOf(service: Service, dir: 1 | -1): number {
  const key = `${service.id}:${dir}`;
  const hit = epochCache.get(key);
  if (hit !== undefined) return hit;
  const group = SERVICES.filter((s) => s.color === service.color)
    .map((s) => s.id)
    .sort();
  const k = Math.max(0, group.indexOf(service.id));
  const n = Math.max(1, group.length);
  const rel = relativeStops(service, dir);
  const ref = rel.find((r) => r.station === TRUNK_REF) ?? rel[rel.length - 1];
  const H = headwayOf(service);
  const slot = Math.round((k * H) / n + (dir === -1 ? H * DIR_PHASE : 0));
  const e = ((((slot - ref.arriveAt) % H) + H) % H) - H;
  epochCache.set(key, e);
  return e;
}
