import * as C from '../config.ts';
import { headwayOf, legMetres, rideTimeFor } from './fleet.ts';
import type { RouteLeg } from './network.ts';

/**
 * WHAT THE TIMETABLE SAYS THIS JOURNEY TAKES.
 *
 * A commute has a scheduled time, and that is the one honest clock to hold a
 * player to. It is computed from the same numbers the trains actually run on,
 * `legMetres` scaled by LEG_SCALE, `rideTimeFor` with its acceleration curve,
 * the 15 s dwell, the 60 s headway, so the schedule is not a balance constant
 * somebody guessed. It is what the fleet would do.
 *
 * The schedule is the RIDE-THROUGH time: board the first train, stay on it,
 * change once, get off at the far end. Fighting is not in it, and that is the
 * point. Waves begin at every stop whether you are on the platform or watching
 * from the train (`onPassedStation` -> `repopulatePlatform`), so getting off to
 * clear a station is a CHOICE, the money is down there, and every minute
 * spent collecting it is a minute over the timetable.
 *
 * That is the whole trade the score is trying to measure. A schedule that
 * already budgeted for fighting would price the choice into the target and
 * measure nothing.
 *
 * The one guess is the wait: half a headway to board and half at the
 * interchange, since a train is as likely to be pulling out as pulling in.
 * PLATFORM_ALLOWANCE_S is NOT part of the target, it is exported only so the
 * run-over screen can say what a thorough run would have cost, and so the
 * punctuality curve has something to be calibrated against.
 */

/** half a headway, twice: once to board, once to change */
const WAITS_PER_JOURNEY = 2;

/**
 * Roughly what clearing one station costs, three waves and the loot picked up
 * after. A GUESS, and deliberately not part of the schedule; it is here to say
 * what a full-clear run would run to, which is about twice the timetable.
 */
export const PLATFORM_ALLOWANCE_S = 55;

export interface Schedule {
  /** riding and dwelling, from the fleet's own arithmetic */
  transitS: number;
  /** waiting for trains */
  waitS: number;
  /** THE TARGET: what the journey takes if you never get off to fight */
  totalS: number;
  /** and what a run that cleared every platform would plausibly take */
  fullClearS: number;
  stops: number;
}

/** the stations a leg calls at, in order, including both ends */
function callsOf(leg: RouteLeg): string[] {
  const all = leg.service.stations;
  const i = all.indexOf(leg.from);
  const out: string[] = [];
  for (let k = 0; k <= leg.stops; k++) out.push(all[i + leg.dir * k]);
  return out;
}

/**
 * The timetable time for a route: every hop's ride, plus a dwell at every
 * station it stands in on the way (not the last, you get off there).
 */
export function scheduleFor(route: RouteLeg[]): Schedule {
  let transitS = 0;
  let stops = 0;
  for (const leg of route) {
    const calls = callsOf(leg);
    for (let i = 1; i < calls.length; i++) {
      transitS += rideTimeFor(legMetres(calls[i - 1], calls[i]));
      // a dwell at every call except the one being ridden away from last
      if (i < calls.length - 1) transitS += C.DWELL_MS / 1000;
      stops += 1;
    }
  }
  // half a headway per wait, at the headway the route's lines actually run
  const meanHeadwayS = route.length
    ? route.reduce((a, l) => a + headwayOf(l.service), 0) / route.length / 1000
    : C.HEADWAY_MS / 1000;
  const waitS = (WAITS_PER_JOURNEY * meanHeadwayS) / 2;
  const totalS = Math.round(transitS + waitS);
  return {
    transitS: Math.round(transitS),
    waitS: Math.round(waitS),
    totalS,
    fullClearS: totalS + stops * PLATFORM_ALLOWANCE_S,
    stops,
  };
}

/** mm:ss, for a screen that is talking about a timetable */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
