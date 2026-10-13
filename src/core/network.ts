/**
 * The Stockholm metro as a graph: three lines, seven services, real stations,
 * real branches, real interchanges. No live data, the game runs its own
 * compressed timetable (see CannedTimetableDriver); this module only knows
 * WHERE things are and HOW to get between them.
 *
 * Services are the numbered lines players read off train signs:
 *   green  17 Åkeshov–Skarpnäck · 18 Alvik–Farsta strand · 19 Hässelby strand–Hagsätra
 *   red    13 Norsborg–Ropsten · 14 Fruängen–Mörby centrum
 *   blue   10 Hjulsta–Kungsträdgården · 11 Akalla–Kungsträdgården
 */

export type LineColor = 'green' | 'red' | 'blue';

export interface Service {
  /** the number on the train */
  id: string;
  color: LineColor;
  /** ordered stations; index 0 is the "backward" terminus */
  stations: string[];
}

// --- shared segments, written once and composed into services ----------------

export { SERVICES } from './lines.ts';
import { SERVICES } from './lines.ts';

// --- derived indexes ---------------------------------------------------------

/** every station name in the network */
export const ALL_STATIONS: string[] = (() => {
  const set = new Set<string>();
  for (const svc of SERVICES) for (const st of svc.stations) set.add(st);
  return [...set];
})();

/** which services call at a station, in a stable order */
export const servicesAt = (station: string): Service[] =>
  SERVICES.filter((s) => s.stations.includes(station));

/** the distinct line colors serving a station, one platform per color */
export const colorsAt = (station: string): LineColor[] => {
  const seen: LineColor[] = [];
  for (const svc of servicesAt(station)) if (!seen.includes(svc.color)) seen.push(svc.color);
  return seen;
};

export interface Departure {
  service: Service;
  /** +1 = toward the end of the station list, -1 = toward the start */
  dir: 1 | -1;
  /** the station this train reaches next from here */
  next: string;
  /** where the sign says it terminates */
  terminus: string;
}

/** every train that can leave `station`, one entry per service and direction */
export const departuresFrom = (station: string): Departure[] => {
  const out: Departure[] = [];
  for (const svc of servicesAt(station)) {
    const i = svc.stations.indexOf(station);
    for (const dir of [1, -1] as const) {
      const j = i + dir;
      if (j < 0 || j >= svc.stations.length) continue;
      out.push({
        service: svc,
        dir,
        next: svc.stations[j],
        terminus: dir === 1 ? svc.stations[svc.stations.length - 1] : svc.stations[0],
      });
    }
  }
  return out;
};

export interface RouteLeg {
  /** board here */
  from: string;
  /** ride to here */
  to: string;
  service: Service;
  dir: 1 | -1;
  terminus: string;
  stops: number;
}

/**
 * Fewest-transfers route (breadth-first over stations, expanding whole rides
 * along a service). Returns the legs, or null if unreachable.
 */
export const findRoute = (from: string, to: string): RouteLeg[] | null => {
  if (from === to) return [];
  const prev = new Map<string, { leg: RouteLeg }>();
  const seen = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const here of frontier) {
      for (const svc of servicesAt(here)) {
        const i = svc.stations.indexOf(here);
        for (const dir of [1, -1] as const) {
          for (let k = 1; ; k++) {
            const j = i + dir * k;
            if (j < 0 || j >= svc.stations.length) break;
            const station = svc.stations[j];
            if (!seen.has(station)) {
              seen.add(station);
              prev.set(station, {
                leg: {
                  from: here,
                  to: station,
                  service: svc,
                  dir,
                  terminus: dir === 1 ? svc.stations[svc.stations.length - 1] : svc.stations[0],
                  stops: k,
                },
              });
              if (station === to) {
                // walk back
                const legs: RouteLeg[] = [];
                let cur = to;
                while (cur !== from) {
                  const step = prev.get(cur)!;
                  legs.unshift(step.leg);
                  cur = step.leg.from;
                }
                return legs;
              }
              next.push(station);
            }
          }
        }
      }
    }
    frontier = next;
  }
  return null;
};

/**
 * WHAT A RUN IS: a journey with a change of line in the middle of it.
 *
 * Three rules, and each one came out of a run that was not worth playing:
 *
 * **It must touch two colours.** Green to green is a straight ride with a
 * fight on it; the change of line is the shape of the game. Nothing has to be
 * done to force ONE change rather than two, `findRoute` is fewest-transfers
 * BFS, and on this network every journey in the length band below turns out to
 * need exactly one. Measured over all 9 801 pairs: not a single legal journey
 * needs two.
 *
 * **It must be a comparable length.** Journeys used to run 5 to 12 stops, so
 * one run was twice the other and neither told you anything about the player.
 * At ~54 s a stop of pure transit (39 s ride, 15 s dwell, before any fighting)
 * the band below is roughly eight to twelve minutes of travelling.
 *
 * **It must not start at T-Centralen.** Every line meets there, so it is the
 * one station where a change costs nothing and every destination is close.
 *
 * Takes the run's random stream rather than reaching for Math.random, because
 * where you are sent is the first thing a replay has to agree about (§11c).
 */
export const MIN_STOPS = 7;
export const MAX_STOPS = 8;
/** the first ride of a run goes THROUGH here: the hub, the king, the kiosk */
export const HUB = 'T-Centralen';
/** every line meets here, which makes it too easy a place to be sent from */
export const NEVER_START = 'T-Centralen';

export interface Journey {
  from: string;
  to: string;
  legs: RouteLeg[];
  stops: number;
}

/**
 * Memoised because it is pure, the network is static, so the legal
 * destinations from a station never change, and because drawing a journey
 * now rejects until it finds the length it wants, which asks the same station
 * the same question repeatedly.
 */
const journeyCache = new Map<string, Journey[]>();

/** the stations a leg calls at, both ends included */
function callsOf(leg: RouteLeg): string[] {
  const all = leg.service.stations;
  const i = all.indexOf(leg.from);
  const out: string[] = [];
  for (let k = 0; k <= leg.stops; k++) out.push(all[i + leg.dir * k]);
  return out;
}

/**
 * The legal destinations from `from`, or an empty list if it is a dead end.
 * THE FIRST RIDE (`first`) is the commute as it has always been: two colours,
 * one change, and it passes through T-Centralen. A LATER RIDE of the chain
 * (sim/chain.ts) is any journey of the length from where you stand, one
 * line is fine, the hub is not required (the user's call, 2026-09-23:
 * every ride 7–8 stops, so the first is fast too and the good part is
 * reached in under an hour).
 */
export function journeysFrom(from: string, first = true): Journey[] {
  const key = `${from}|${first ? 'first' : 'any'}`;
  const hit = journeyCache.get(key);
  if (hit) return hit;
  const out: Journey[] = [];
  for (const to of ALL_STATIONS) {
    if (to === from) continue;
    const legs = findRoute(from, to);
    if (!legs || legs.length === 0) continue;
    const stops = legs.reduce((n, l) => n + l.stops, 0);
    if (stops < MIN_STOPS || stops > MAX_STOPS) continue;
    if (first) {
      // two COLOURS, not merely two services: red 13 to red 14 is still the red line
      const colours = new Set(legs.map((l) => l.service.color));
      if (colours.size < 2) continue;
      if (!legs.some((l) => callsOf(l).includes(HUB))) continue;
    }
    out.push({ from, to, legs, stops });
  }
  journeyCache.set(key, out);
  return out;
}

/**
 * A whole journey from the run's stream. Some stations, the far termini, out
 * past Hässelby and Norsborg, cannot reach a second colour inside the band at
 * all, so a start is REJECTED and re-drawn rather than quietly relaxed: 90 of
 * the 99 possible starts can open a run, and the other nine simply never do.
 */
export function pickJourney(rng: () => number): Journey {
  const starts = ALL_STATIONS.filter((s) => s !== NEVER_START);
  // THE LENGTH IS DRAWN FIRST, and that is the whole point. Sampling journeys
  // uniformly instead would lean long, there are simply more 13-stop journeys
  // on this network than 9-stop ones, about two and a half times as many, so
  // most runs would sit at the top of the band and the short ones would be a
  // curiosity. Choosing the length and then a journey of that length makes all
  // five equally likely, which is the variety worth having.
  const target = MIN_STOPS + Math.floor(rng() * (MAX_STOPS - MIN_STOPS + 1));
  for (let tries = 0; tries < 80; tries++) {
    const from = starts[Math.floor(rng() * starts.length)];
    const options = journeysFrom(from).filter((j) => j.stops === target);
    if (options.length) return options[Math.floor(rng() * options.length)];
  }
  // that length is unusually thin on this network; take any legal journey
  for (let tries = 0; tries < 60; tries++) {
    const from = starts[Math.floor(rng() * starts.length)];
    const options = journeysFrom(from);
    if (options.length) return options[Math.floor(rng() * options.length)];
  }
  // Unreachable on this network, and a run still has to start somewhere. Draw
  // from the whole legal set rather than inventing a journey that breaks the
  // rules above.
  for (const from of starts) {
    const options = journeysFrom(from);
    if (options.length) return options[0];
  }
  throw new Error('no legal journey exists on this network');
}

/**
 * THE NEXT RIDE of a chain (sim/chain.ts) starts where the last one ended:
 * the same draw, length first, so every length is equally likely, from
 * ONE station. A terminus with nothing legal of that length takes any
 * legal journey from there; a station with none at all falls back to a
 * fresh deal, which cannot happen on this network but must not throw.
 */
export function pickJourneyFrom(rng: () => number, from: string): Journey {
  const all = journeysFrom(from, false);
  if (all.length === 0) return pickJourney(rng);
  const target = MIN_STOPS + Math.floor(rng() * (MAX_STOPS - MIN_STOPS + 1));
  const options = all.filter((j) => j.stops === target);
  const pool = options.length ? options : all;
  return pool[Math.floor(rng() * pool.length)];
}

/** where the tutorial is played: a straight indoor platform with two islands,
 * a mana machine ten metres from where you appear, and one stop to ride */
export const TUTORIAL_FROM = 'Näckrosen';
/** ...and what it is called while the tutorial is played there */
export const TUTORIAL_NAME = 'Tutorialstorg';
/** a station's name as the screen says it: the tutorial's platform has its own */
export const shownName = (name: string, tutorial: boolean): string =>
  tutorial && name === TUTORIAL_FROM ? TUTORIAL_NAME : name;
export const TUTORIAL_TO = 'Solna centrum';
export function tutorialJourney(): Journey {
  const legs = findRoute(TUTORIAL_FROM, TUTORIAL_TO);
  if (!legs) throw new Error('the tutorial journey is not on the network');
  return { from: TUTORIAL_FROM, to: TUTORIAL_TO, legs, stops: legs.reduce((n, l) => n + l.stops, 0) };
}

export { shortName } from './stationNames.ts';

/**
 * THE WAY A LINE RUNS, as one sign per colour: +1 means "toward increasing
 * station index" is the line's forward direction. Every service of a colour
 * lists its stations in the same order, but red lists the shared trunk the
 * other way round from green, so a storey they share (T-Centralen, Gamla
 * stan, Slussen) needs one convention for both, or every station along one
 * of the lines faces the other way from its neighbour and the world turns
 * half a turn under a rider at the handover (from play 2026-09-03).
 */
const orderSigns = new Map<LineColor, 1 | -1>();
export function orderSign(color: LineColor): 1 | -1 {
  if (orderSigns.size === 0) {
    const colors = [...new Set(SERVICES.map((s) => s.color))];
    orderSigns.set(colors[0], 1);
    // settle the rest against an already settled colour they share stations with
    let progress = true;
    while (progress) {
      progress = false;
      for (const c of colors) {
        if (orderSigns.has(c)) continue;
        for (const a of SERVICES.filter((s) => s.color === c)) {
          for (const b of SERVICES.filter((s) => orderSigns.has(s.color))) {
            const shared = a.stations.filter((st) => b.stations.includes(st));
            if (shared.length < 2) continue;
            const da = a.stations.indexOf(shared[1]) - a.stations.indexOf(shared[0]);
            const db = b.stations.indexOf(shared[1]) - b.stations.indexOf(shared[0]);
            orderSigns.set(
              c,
              (Math.sign(da) === Math.sign(db) ? 1 : -1) * orderSigns.get(b.color)! > 0 ? 1 : -1,
            );
            progress = true;
            break;
          }
          if (orderSigns.has(c)) break;
        }
      }
    }
    for (const c of colors) if (!orderSigns.has(c)) orderSigns.set(c, 1);
  }
  return orderSigns.get(color) ?? 1;
}

/** a track's running direction in the LINE's sense: +1 runs the line forward */
export function lineDirOf(service: Service, dir: 1 | -1): 1 | -1 {
  return (dir * orderSign(service.color)) as 1 | -1;
}
