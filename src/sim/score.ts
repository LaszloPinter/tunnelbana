/**
 * WHAT A RUN WAS WORTH.
 *
 * The journey is a fixed 9-13 stops now (src/core/network.ts), and that
 * quietly killed the obvious scoreboard: everybody who arrives has travelled
 * exactly the same distance, so "stops" only separates the people who did NOT
 * make it. It is a measure of failure, and cannot be the score.
 *
 * Kronor can. The money is already the interesting decision in the game,
 * coins come off the horde, Bergakungen pays 1300, and it all goes back out
 * again on cards and tickets that keep you alive. So what you walk out with is
 * exactly what you did not need to spend to survive, which is the same thing
 * as how well you played. One number, one word, and the greed dial is the
 * whole game.
 *
 * Arriving DOUBLES it. Without that, extracting early through the first exit
 * you see is a perfectly good strategy, and the game is called Get Where You
 * Are Going. With it, a finished journey always beats a good early bail.
 *
 * Dying banks nothing. This is an extraction game and that is the genre's
 * oldest rule: carry it out or lose it. The run is still posted, the board
 * shows how far you got, it is simply worth zero.
 *
 * ---- and why time is in here after all ----
 *
 * It went in for the opposite of the obvious reason. A platform is NOT a farm:
 * a station holds a fixed three waves and then the spawner stops for good
 * (§16, src/combat/waves.ts), so staying longer earns nothing and eventually
 * the dark takes the platform. Time is not needed to stop hoarding.
 *
 * But that same rule means the money in a run is BOUNDED, three waves a
 * station, plus Bergakungen, so kronor saturates. Two players who both clear
 * everything and arrive would otherwise tie, and at the top of a board they
 * nearly all would. Time is what is left to separate them, and on a commute it
 * is the thing worth separating them by.
 *
 * So the clock is a multiplier against the journey's own timetable
 * (src/core/schedule.ts), not a subtraction with an invented rate. Arrive
 * within the schedule and you are paid in full; run late and the fare drops,
 * to a floor. The schedule is computed from what the fleet actually does.
 */

export type RunOutcome = 'win' | 'extract' | 'died';

export interface RunResult {
  outcome: RunOutcome;
  /** kronor in hand when the run ended */
  kr: number;
  stops: number;
  kills: number;
  bosses: number;
  seconds: number;
  /** what the timetable said this journey should take (src/core/schedule.ts) */
  scheduledS?: number;
}

/** arriving is worth twice the takings */
export const ARRIVAL_MULTIPLIER = 2;

/**
 * The fare curve, and the honest position on it: these three numbers are the
 * only part of the scoring with no evidence behind them.
 *
 * What IS known: the schedule is the ride-through time, and clearing every
 * platform costs roughly as much again, so a thorough run lands near 2x the
 * timetable and a greedy one beyond it. The gradient therefore has to cover
 * 1x to about 3x, or everybody who stops to fight sits on the floor together
 * and the clock stops separating anybody.
 *
 * What is NOT known is how steep it should be, because that depends on how
 * fast money actually comes in, which needs runs to measure. Tune here.
 */
/** a little stopping is free; the timetable is not a stopwatch */
export const GRACE = 1.25;
/** and how late it has to get before lateness stops costing more */
export const LATE_FLOOR = 0.45;
/** three times the timetable is as bad as it gets */
export const WORST_OVERRUN = 3.0;

/**
 * What the clock does to the fare. One at or near the schedule, falling
 * linearly to LATE_FLOOR by the time a run has taken twice as long as it
 * should. Being FAST than schedule pays nothing extra, the timetable is the
 * timetable, and a bonus for beating it would just reward skipping fights.
 */
export function punctuality(scheduledS: number, actualS: number): number {
  if (scheduledS <= 0) return 1;
  const ratio = actualS / scheduledS;
  if (ratio <= GRACE) return 1;
  const over = (ratio - GRACE) / (WORST_OVERRUN - GRACE);
  return Math.max(LATE_FLOOR, 1 - over * (1 - LATE_FLOOR));
}

export function scoreOf(r: RunResult): number {
  if (r.outcome === 'died') return 0;
  const banked = Math.max(0, Math.round(r.kr));
  const arrival = r.outcome === 'win' ? ARRIVAL_MULTIPLIER : 1;
  const onTime = r.scheduledS ? punctuality(r.scheduledS, r.seconds) : 1;
  return Math.round(banked * arrival * onTime);
}

/** how the clock reads on the run-over screen */
export function lateness(scheduledS: number, actualS: number): string {
  const d = Math.round(actualS - scheduledS);
  if (d <= 0) return `${Math.abs(d)}s early`;
  return `${d}s late`;
}

/** how the run reads on a board row */
export function describe(r: RunResult): string {
  const kr = `${Math.max(0, Math.round(r.kr))} kr`;
  const late =
    r.scheduledS && r.seconds > r.scheduledS * GRACE
      ? ` · ${lateness(r.scheduledS, r.seconds)}, fare ×${punctuality(r.scheduledS, r.seconds).toFixed(2)}`
      : '';
  if (r.outcome === 'win') return `arrived · ${kr} ×${ARRIVAL_MULTIPLIER}${late}`;
  if (r.outcome === 'extract') return `left early at stop ${r.stops} · ${kr}${late}`;
  return `lost at stop ${r.stops}`;
}

/** better is a higher score, and on a tie, the faster run */
export const beats = (
  a: { score: number; seconds: number },
  b: { score: number; seconds: number },
): boolean => (a.score !== b.score ? a.score > b.score : a.seconds < b.seconds);
