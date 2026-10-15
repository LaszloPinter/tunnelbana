import { pickJourneyFrom } from '../core/network.ts';
import { scheduleFor } from '../core/schedule.ts';
import { ARRIVAL_MULTIPLIER, punctuality } from './score.ts';
import { asStation } from './place.ts';
import { beginStationWaves } from '../combat/waves.ts';
import type { Player } from './player.ts';
import { levelIndexFor, rebuildHere } from './stationBuild.ts';
import { placeOnMap } from '../world/start2d.ts';
import type { Station } from './station.ts';
import type { Run } from './run.ts';

/**
 * THE JOURNEY CHAIN (the user's call, 2026-09-17).
 *
 * Arriving does not end the run: it BANKS the ride and deals the next one,
 * from the platform you are standing on, with everything you carry, the
 * card, the perks, the level, the kronor. Each ride is worth more and is
 * a great deal harder: the first is casual, the second is difficult, the
 * third and every one after is inhumane. "Think Diablo." The run ends by
 * dying, or by walking out of any exit before the next destination,
 * cashing out with what is banked plus what is in hand. That makes the
 * daily a question of how FAR you can get, not how fast you do the same
 * path as everyone else.
 *
 * The ramp, per ride (0 = the first):
 *   hp        ×(1 + 0.8r + 0.15r²)  1 · 2.0 · 3.2 · 4.8 (ride 6: 8.9)
 *   damage    ×(1 + 0.45r)          1 · 1.45 · 1.9 · 2.35
 *   numbers   ×(1 + 0.35r)          and one more wave a station
 *   the pack  a growing share (45%/ride) is SMART: it holds a ring when
 *             the bite is crowded instead of queueing for your bolts, and
 *             sidesteps a bolt coming down its line (combat/enemyPack.ts)
 *   elites    8% + 7%/ride; brutes 16% + 5%/ride; pace +5%/ride
 *   the look  darker every ride (render/enemyRig.ts `dark`)
 *   score     the banked ride is worth ×2.5 per ride already made
 */

export const rideHpMul = (ride: number): number => 1 + 0.8 * ride + 0.15 * ride * ride;
/** xp comes faster on later rides, so the lanes keep pace with the ramp:
 * with every ride 7–8 stops and every station cleared, the eighth lane pick
 * lands at the end of ride four (~340 kills a ride at first, +35%/ride) */
export const rideXpMul = (ride: number): number => 1 + 0.5 * ride;
/** max hp grows with the party's level: survival scales without a pick */
export const HP_PER_LEVEL = 5;
export const rideDmgMul = (ride: number): number => 1 + 0.45 * ride;
export const rideCountMul = (ride: number): number => 1 + 0.35 * ride;
export const rideScoreMul = (ride: number): number => {
  let m = 1;
  for (let i = 0; i < ride; i++) m *= 2.5;
  return m;
};
export const rideSmartChance = (ride: number): number => Math.min(0.9, 0.45 * ride);
export const rideDark = (ride: number): number => Math.min(0.65, 0.22 * ride);

/** arriving pays: kronor per ride made, and xp worth half the next level */
export const ARRIVAL_KR = 150;

/** a ride that was made: what the run-over screen and the board read */
export interface RideDone {
  from: string;
  to: string;
  stops: number;
  kr: number;
  seconds: number;
  worth: number;
}

/** a ride just made, as the victory screen tells it: every factor of the worth */
export interface RideSummary {
  /** rides made, this one included */
  ride: number;
  wrong: boolean;
  from: string;
  to: string;
  stops: number;
  seconds: number;
  /** the timetable's time for the ride, 0 when there was none */
  scheduleS: number;
  /** takings in hand at the exit */
  inHand: number;
  arrivalMul: number;
  onTime: number;
  chainMul: number;
  worth: number;
  banked: number;
  /** the arrival's pay, to every living seat */
  kr: number;
  xp: number;
  /** where the next ride goes */
  next: string;
}

/** what the ride in progress would bank if it ended right now */
function inHand(run: Run): number {
  return Math.max(0, Math.round(run.players.reduce((a, p) => a + Math.max(0, p.money), 0)));
}

/** a ride's worth on arrival: the takings, doubled, by the clock, by the chain */
export function rideWorth(run: Run, now: number): number {
  const secs = (now - run.rideStart) / 1000;
  const onTime = run.rideScheduleS > 0 ? punctuality(run.rideScheduleS, secs) : 1;
  return Math.round(inHand(run) * ARRIVAL_MULTIPLIER * onTime * rideScoreMul(run.ride));
}

/**
 * THE FINAL SCORE. What is banked stands, and what is in hand counts at face
 * value, by the clock, whether you walked out early or went down: the
 * arrival's doubling and the chain are what arriving is for. A death used to
 * throw the ride in hand away, and a first ride lost scored 0 for four
 * stations and a platform of kills (from play 2026-10-15: "why 0 score?").
 */
export function finalScore(run: Run, now: number): number {
  if (!run.over) return run.banked;
  if (run.over.kind === 'win') return run.banked + rideWorth(run, now);
  const secs = (now - run.rideStart) / 1000;
  const onTime = run.rideScheduleS > 0 ? punctuality(run.rideScheduleS, secs) : 1;
  return run.banked + Math.round(inHand(run) * onTime);
}

/** a ride begins from where the party stands: the next destination, its timetable, its clock */
export function dealRide(run: Run, from: string, now: number) {
  const j = pickJourneyFrom(run.rng, from);
  run.destStation = j.to;
  run.route = j.legs;
  run.rideFrom = from;
  run.stopsTraveled = 0;
  run.rideStreak = 0;
  run.rideStart = now;
  run.rideScheduleS = scheduleFor(j.legs).totalS;
}

/**
 * A RIDE STARTS AT THE SPAWN POINT, not at the exit you left the last one
 * by (the user's call, 2026-09-27): walking out is going home, and the next
 * ride is a new start from the station's middle, on the storey its first
 * train leaves from, exactly as the first ride of a run starts. Standing on
 * the exit also put "Press E, wrong station" under your feet the moment
 * the ride began.
 */
function startFromSpawn(run: Run, st: Station) {
  const first = run.route[0];
  const level = first ? levelIndexFor(st.name, first.service.id, first.dir) : st.levelIndex;
  if (level !== st.levelIndex) {
    st.stashFloor();
    st.levelIndex = level;
    rebuildHere(run);
    st.restoreFloor();
  }
  placeOnMap(run);
  run.host.stationChanged('shaft');
}

/**
 * The party walked out of the destination's exit: the ride is banked, the
 * next is dealt from this platform, and the whole network's stations start
 * over, harder. The world holds for the card (sim/player.ts Pause 'ride').
 */
export function arriveRide(run: Run, p: Player, now: number, wrong = false) {
  const st = asStation(run.placeOf(p));
  if (!st) return;
  // AT THE WRONG STATION the chain goes on just the same, harder, but
  // nothing is banked and nothing is paid: leaving early is the penalty
  // (the user's call, 2026-09-23). The run ends only by dying.
  const worth = wrong ? 0 : rideWorth(run, now);
  const seconds = (now - run.rideStart) / 1000;
  const scheduleS = run.rideScheduleS;
  const chainMul = rideScoreMul(run.ride);
  const xpBefore = run.party.xp;
  run.banked += worth;
  run.rides.push({
    from: run.rideFrom,
    to: st.name,
    stops: run.stopsTraveled,
    kr: inHand(run),
    seconds: Math.round((now - run.rideStart) / 1000),
    worth,
  });
  run.ride += 1;
  // THE TUTORIAL ENDS HERE: one stop ridden is the whole lesson. No next
  // ride is dealt and nothing is scored (the session takes it from here)
  if (run.tutorial) {
    run.finishRun('win', 'You got where you were going.');
    return;
  }
  // arriving pays: kronor for the ride made, and half a level
  if (!wrong) {
    const kr = ARRIVAL_KR * run.ride;
    for (const q of run.players) if (q.alive) q.money += kr;
    run.party.xp += Math.round(run.party.xpNext / 2);
  }
  dealRide(run, st.name, now);
  startFromSpawn(run, st);
  // every platform is the horde's again, this one first: what you cleared
  // on the last ride was the last ride's
  for (const pl of run.places.values()) {
    const q = asStation(pl);
    if (!q || q === st) continue;
    q.wave = 0;
    q.cleared = false;
  }
  beginStationWaves(run.hostFor(st), now);
  for (const q of run.players) {
    q.iframesUntil = now + 3500;
    q.shelf = null;
  }
  // the world holds until the party says go (combat/progression.ts stepPause)
  run.pause = { kind: 'ride', left: Infinity, ready: 0 };
  run.host.arrived({
    ride: run.ride,
    wrong,
    from: run.rides[run.rides.length - 1].from,
    to: st.name,
    stops: run.rides[run.rides.length - 1].stops,
    seconds,
    scheduleS,
    inHand: run.rides[run.rides.length - 1].kr,
    arrivalMul: ARRIVAL_MULTIPLIER,
    onTime: scheduleS > 0 ? punctuality(scheduleS, seconds) : 1,
    chainMul,
    worth,
    banked: run.banked,
    kr: wrong ? 0 : ARRIVAL_KR * run.ride,
    xp: run.party.xp - xpBefore,
    next: run.destStation,
  });
}
