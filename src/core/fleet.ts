import * as C from '../config.ts';
import { SERVICES, type Service } from './network.ts';
import { epochOf, headwayOf, relativeStops, routeOf } from './timetable.ts';

export { headwayOf, legMetres, rideTimeFor, TURNBACK_MS, MIN_TRACK_GAP_MS } from './timetable.ts';

/**
 * THE FLEET (§18): every train on the network, as arithmetic.
 *
 * A train is ONE object with a name you can say out loud, "the 17 toward
 * Skarpnäck, the one due in ninety seconds", and it exists whether or not
 * anybody is looking at it. That is what makes running a tunnel real: the
 * train that kills you out there is the same train your friend is riding,
 * and holding a platform for someone means holding it for a train that is
 * genuinely coming.
 *
 * The trick that makes it affordable is that a journey is a PURE FUNCTION of
 * its identity and the clock. A journey is `(service, direction, k)`, the
 * k-th departure of that service that way, and from those three numbers
 * every arrival and departure along its whole route falls out by arithmetic,
 * from real leg distances and the train's own acceleration. Nothing is
 * simulated until somebody can see it: an unobserved train costs nothing,
 * so the whole network can be "running" at once, and a place only realises
 * the handful of `Train` objects actually in it.
 *
 * Nothing here draws on any random stream, so four clients agree on the
 * whole network's traffic without exchanging a word about it.
 */

export interface Stop {
  station: string;
  /** sim-clock ms this train reaches the platform */
  arriveAt: number;
  /** ...and leaves it */
  departAt: number;
}

export interface Journey {
  /** `17:+1:42`, stable, and the thing a rider's frame refers to */
  id: string;
  service: Service;
  dir: 1 | -1;
  /** which departure of this service, that way */
  k: number;
  stops: Stop[];
  /** where the sign says it ends */
  terminus: string;
}

export const journeyId = (service: Service, dir: 1 | -1, k: number): string =>
  `${service.id}:${dir > 0 ? '+' : '-'}:${k}`;

/** the whole journey: every stop, with the times it makes them. Cached, the
 * one-world sim asks about the same handful of journeys every tick */
const journeyCache = new Map<string, Journey>();

/** a Map keeps insertion order: drop the oldest quarter, never the lot,
 * clearing wholesale made a periodic stall as every live journey rebuilt */
export function evictOldest<V>(cache: Map<string, V>) {
  const drop = Math.ceil(cache.size / 4);
  let n = 0;
  for (const key of cache.keys()) {
    if (n++ >= drop) break;
    cache.delete(key);
  }
}

export function journeyOf(service: Service, dir: 1 | -1, k: number): Journey {
  const id = journeyId(service, dir, k);
  const hit = journeyCache.get(id);
  if (hit) return hit;
  const j = buildJourney(service, dir, k);
  if (journeyCache.size > 1024) evictOldest(journeyCache);
  journeyCache.set(id, j);
  return j;
}

function buildJourney(service: Service, dir: 1 | -1, k: number): Journey {
  const route = routeOf(service, dir);
  const t0 = epochOf(service, dir) + k * headwayOf(service);
  const stops: Stop[] = relativeStops(service, dir).map((r) => ({
    station: r.station,
    arriveAt: t0 + r.arriveAt,
    departAt: t0 + r.arriveAt + C.DWELL_MS,
  }));
  return {
    id: journeyId(service, dir, k),
    service,
    dir,
    k,
    stops,
    terminus: route[route.length - 1],
  };
}

/** the services that call at a station, each way, without duplicates */
function servicesThrough(station: string): { service: Service; dir: 1 | -1 }[] {
  const out: { service: Service; dir: 1 | -1 }[] = [];
  for (const service of SERVICES) {
    if (!service.stations.includes(station)) continue;
    for (const dir of [1, -1] as const) {
      const route = routeOf(service, dir);
      // a terminus is not a departure in the direction it terminates
      if (route.indexOf(station) === route.length - 1) continue;
      out.push({ service, dir });
    }
  }
  return out;
}

/**
 * Every journey whose stop at `station` falls inside [now - back, now + ahead].
 *
 * The arithmetic that makes the fleet cheap: a service's arrival time at a
 * given station is linear in k with step its headway, so the handful of journeys
 * near a moment are found by solving for k rather than by searching.
 */
/**
 * THE PIN: which journeys exist at all. Null is every one, which is the
 * network. The tutorial run pins 'none', nothing runs, no rail has a body,
 * no metal is near anyone, until its last stage, and then pins exactly
 * the train the lesson is about, brought in on cue and held at the platform
 * (sim/tutorialTrain.ts). Both enumerations below answer from the pin, so
 * a pinned journey is found however far its held timetable drifts from the
 * headway grid the enumerations otherwise solve on.
 */
let pin: 'none' | Journey | null = null;
export function setFleetPin(p: 'none' | Journey | null) {
  pin = p;
  nearCache.clear();
}
/** the pinned answer for a station and window, if a pin is set */
function pinned(station: string, lo: number, hi: number): Journey[] | null {
  if (pin === null) return null;
  if (pin === 'none') return [];
  const at = stopAt(pin, station);
  return at && at.departAt >= lo && at.arriveAt <= hi ? [pin] : [];
}

/** a journey's stop times moved, from stop `from` on (the tutorial's held
 * train): the motion built from them must be forgotten by the caller */
export function shiftStops(j: Journey, from: number, deltaMs: number) {
  for (let i = from; i < j.stops.length; i++) {
    j.stops[i].arriveAt += deltaMs;
    j.stops[i].departAt += deltaMs;
  }
}

export function journeysAt(station: string, now: number, back = 0, ahead = C.HEADWAY_MS * 3): Journey[] {
  const pinnedOut = pinned(station, now - back, now + ahead);
  if (pinnedOut) return pinnedOut;
  const out: Journey[] = [];
  for (const { service, dir } of servicesThrough(station)) {
    const zero = journeyOf(service, dir, 0);
    const stop = zero.stops.find((s) => s.station === station);
    if (!stop) continue;
    const H = headwayOf(service);
    const kLo = Math.floor((now - back - stop.departAt) / H);
    const kHi = Math.ceil((now + ahead - stop.arriveAt) / H);
    for (let k = kLo; k <= kHi; k++) {
      // k may be NEGATIVE, and must be: a train standing at a mid-line
      // station at t=0 left its terminus twenty minutes before the run began.
      // The network is already running when you walk into it.
      const j = journeyOf(service, dir, k);
      const at = j.stops.find((s) => s.station === station)!;
      if (at.departAt >= now - back && at.arriveAt <= now + ahead) out.push(j);
    }
  }
  return out.sort((a, b) => stopAt(a, station)!.arriveAt - stopAt(b, station)!.arriveAt);
}

export const stopAt = (j: Journey, station: string): Stop | undefined =>
  j.stops.find((s) => s.station === station);

/**
 * Every journey of ONE service, either direction, whose stop at `station`
 * falls within ±window of now, INCLUDING journeys that terminate there.
 * `journeysAt` excludes terminating arrivals because it answers "what can I
 * board"; the one-world train realisation needs the arrivals too, because an
 * arriving train at a terminus is a real train that will visibly run into
 * the siding and come back (journeyMotion.turnsInto).
 */
/**
 * Cached per (service, station, window, second). Every rail asks this every
 * tick and it walks the timetable each time; the answer only changes as the
 * second does, and a tick is a sixtieth (2026-09-05).
 */
const nearCache = new Map<string, { at: number; out: Journey[] }>();

export function journeysOfServiceNear(
  service: Service,
  station: string,
  now: number,
  window: number,
): Journey[] {
  const sec = Math.floor(now / 1000);
  const key = `${service.id}|${station}|${window}`;
  const hit = nearCache.get(key);
  if (hit && hit.at === sec) return hit.out;
  const out = journeysNear(service, station, now, window);
  if (nearCache.size > 4096) nearCache.clear();
  nearCache.set(key, { at: sec, out });
  return out;
}

function journeysNear(service: Service, station: string, now: number, window: number): Journey[] {
  const pinnedOut = pinned(station, now - window, now + window);
  if (pinnedOut) return pinnedOut.filter((j) => j.service.id === service.id);
  const out: Journey[] = [];
  for (const dir of [1, -1] as const) {
    const zero = journeyOf(service, dir, 0);
    const stop = zero.stops.find((s) => s.station === station);
    if (!stop) continue;
    const H = headwayOf(service);
    const kLo = Math.floor((now - window - stop.departAt) / H);
    const kHi = Math.ceil((now + window - stop.arriveAt) / H);
    for (let k = kLo; k <= kHi; k++) {
      const j = journeyOf(service, dir, k);
      const at = j.stops.find((s) => s.station === station)!;
      if (at.departAt >= now - window && at.arriveAt <= now + window) out.push(j);
    }
  }
  return out;
}

/**
 * Where a journey is right now: dwelling at a station, running a leg (with
 * how far along it is), or not yet started / already finished.
 */
export type Where =
  | { kind: 'before' }
  | { kind: 'at'; station: string; stop: Stop }
  | { kind: 'leg'; from: string; to: string; frac: number }
  | { kind: 'done' };

export function whereIs(j: Journey, now: number): Where {
  const first = j.stops[0];
  const last = j.stops[j.stops.length - 1];
  if (now < first.arriveAt) return { kind: 'before' };
  if (now > last.departAt) return { kind: 'done' };
  for (let i = 0; i < j.stops.length; i++) {
    const s = j.stops[i];
    if (now >= s.arriveAt && now <= s.departAt) return { kind: 'at', station: s.station, stop: s };
    const nxt = j.stops[i + 1];
    if (nxt && now > s.departAt && now < nxt.arriveAt) {
      return {
        kind: 'leg',
        from: s.station,
        to: nxt.station,
        frac: (now - s.departAt) / (nxt.arriveAt - s.departAt),
      };
    }
  }
  return { kind: 'done' };
}

/** every journey running the leg between these two stations right now */
export function journeysOnLeg(a: string, b: string, now: number): { j: Journey; frac: number }[] {
  const out: { j: Journey; frac: number }[] = [];
  for (const station of [a, b]) {
    for (const j of journeysAt(station, now, C.HEADWAY_MS * 2, C.HEADWAY_MS * 2)) {
      const w = whereIs(j, now);
      if (w.kind !== 'leg') continue;
      const same = (w.from === a && w.to === b) || (w.from === b && w.to === a);
      if (same && !out.some((o) => o.j.id === j.id)) out.push({ j, frac: w.frac });
    }
  }
  return out;
}

/** a journey back from its id, `17:+:42`. The id is the cache's own key,
 * so a hit is one lookup: parsing it first, split, find the service, parse
 * the number, was 7% of the simulation on its own, asked for every train
 * near every body for every step it might take (profiled 2026-09-15). */
export function journeyById(id: string): Journey | undefined {
  const hit = journeyCache.get(id);
  if (hit) return hit;
  const [svc, sign, kStr] = id.split(':');
  const service = SERVICES.find((s) => s.id === svc);
  const k = Number(kStr);
  if (!service || !Number.isFinite(k)) return undefined;
  return journeyOf(service, sign === '+' ? 1 : -1, k);
}

/**
 * "Kort tåg": roughly one train in five runs short, two units instead of
 * three, stopping with its nose on the same mark, so the back half of the
 * platform gets nothing. It is a property of the TRAIN, not of the moment it
 * happens to be looked at, so it is derived from the journey's id: the same
 * train is short at every station along its route, which is what a short
 * train is.
 */
export function isShortTrain(id: string): boolean {
  let h = 5;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 33) + id.charCodeAt(i)) | 0;
  // avalanche, or consecutive departures of one service land in the same
  // bucket: without it the northbound 13 ran short every single trip and the
  // southbound never did, at a perfectly respectable 22% overall (measured)
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % 100 < 22;
}

/** what a rider would say out loud: "the 17 toward Skarpnäck" */
export const journeyName = (j: Journey): string => `${j.service.id} toward ${j.terminus}`;
