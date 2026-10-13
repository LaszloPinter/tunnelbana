import * as C from '../config.ts';
import { journeyById, journeyOf, setFleetPin, shiftStops, stopAt } from '../core/fleet.ts';
import { headwayOf } from '../core/timetable.ts';
import { forgetMotion } from '../core/journeyMotion.ts';
import { TUTORIAL_FROM } from '../core/network.ts';
import type { Run } from './run.ts';
import type { Station } from './station.ts';

/**
 * THE TUTORIAL'S ONE TRAIN.
 *
 * Until the last stage the platform is quiet: the fleet is pinned to
 * nothing, so no rail has a body, no metal is near anyone and the boards
 * count down to nothing. When the overlay says the player is ready, the
 * journey the lesson is about, the leg the run dealt, has its whole
 * timetable SHIFTED to reach the platform eight seconds from now, and is
 * pinned as the one train that exists. At the platform it is HELD: its
 * departure is pushed ten minutes out in one move, so the doors stand open;
 * the moment someone is aboard the departure is pulled back to a breath
 * from now, and the doors close. Two shifts in all, each one rebuilds the
 * journey's motion curve, and a shift a second was a stutter a second.
 *
 * Nothing here draws on the run's stream and none of it runs outside a
 * tutorial run, which is never saved or replayed.
 */

/** how long after "ready" the train is at the platform */
const ARRIVE_IN_MS = 8_000;
/** the hold: longer than anyone dawdles */
const HOLD_MS = 10 * 60_000;
/** once aboard, the doors begin closing this soon */
const AFTER_BOARDING_MS = C.DOOR_CLOSE_LEAD_MS + 300;
/**
 * THE RIDE ITSELF IS SHORT. Näckrosen to Solna centrum is a minute in the
 * timetable, and a minute of looking at a tunnel is the dullest part of the
 * lesson (the user's call, 2026-09-30: "make the ride fast, it's boring").
 * Once aboard, the arrival is pulled in so the leg takes this long; the
 * train's motion is fitted to its stops, so it simply runs the tunnel fast.
 */
const TUTORIAL_LEG_MS = 15_000;

/** at the start of a run: nothing runs in a tutorial run, everything in any other */
export function installTutorialFleet(run: Run) {
  run.tutorialTrain = null;
  run.tutorialHeld = false;
  run.tutorialPen = null;
  setFleetPin(run.tutorial ? 'none' : null);
}

/**
 * TUTORIALSTORG: a small pen on the tutorial platform, just wide enough for
 * where you appear, the MANA and HEALTH machines and the kiosk, with a few
 * metres to spare, so the machines are always on screen and the tunnels are
 * out of reach (from play 2026-09-26: "make the tutorial map much smaller").
 * Across the platform it is open: the train you board stands alongside, and
 * its doors run the whole length, so some of them are always in the pen.
 */
const PEN_MARGIN = C.M(6);
const PEN_MIN = C.M(30);
export function tutorialPen(run: Run, st: Station) {
  const xs = [
    (st.platformX0 + st.platformX1) / 2,
    ...st.manaMachines.map((m) => m.x),
    ...st.healthMachines.map((m) => m.x),
    ...st.kiosks.map((k) => k.x),
  ];
  let x0 = Math.min(...xs) - PEN_MARGIN;
  let x1 = Math.max(...xs) + PEN_MARGIN;
  if (x1 - x0 < PEN_MIN) {
    const mid = (x0 + x1) / 2;
    x0 = mid - PEN_MIN / 2;
    x1 = mid + PEN_MIN / 2;
  }
  run.tutorialPen = {
    station: st.name,
    x0: Math.max(st.platformX0 + C.M(2), x0),
    x1: Math.min(st.platformX1 - C.M(2), x1),
  };
}

/** the last stage began: bring the train in on cue */
export function tutorialReady(run: Run, now: number) {
  if (!run.tutorial || run.tutorialTrain) return;
  const leg = run.route[0];
  if (!leg) return;
  // the next departure of this service, this way, whose stop here is not
  // yet made, then moved so it is made eight seconds from now
  const zero = journeyOf(leg.service, leg.dir, 0);
  const s0 = stopAt(zero, TUTORIAL_FROM);
  if (!s0) return;
  const H = headwayOf(leg.service);
  const k = Math.ceil((now - s0.arriveAt) / H);
  const j = journeyOf(leg.service, leg.dir, k);
  const at = stopAt(j, TUTORIAL_FROM);
  if (!at) return;
  shiftStops(j, 0, now + ARRIVE_IN_MS - at.arriveAt);
  forgetMotion(j.id);
  run.tutorialTrain = j.id;
  setFleetPin(j);
}

/** every tick: the train waits at the platform for the player, then goes */
export function holdTutorialTrain(run: Run, now: number) {
  const jid = run.tutorialTrain;
  if (!jid) return;
  const j = journeyById(jid);
  if (!j) return;
  const i = j.stops.findIndex((s) => s.station === TUTORIAL_FROM);
  if (i < 0) return;
  const stop = j.stops[i];
  if (now < stop.arriveAt) return;
  const aboard = run.players.some((p) => p.frame.kind === 'aboard' && p.frame.jid === jid);
  if (!run.tutorialHeld && !aboard && stop.departAt - now < HOLD_MS / 2) {
    // at the platform with nobody aboard: hold it, once
    holdDeparture(j, i, HOLD_MS);
    forgetMotion(jid);
    run.tutorialHeld = true;
  } else if (run.tutorialHeld && aboard) {
    // someone is aboard: the doors close now, and the tunnel is a short one
    holdDeparture(j, i, now + AFTER_BOARDING_MS - stop.departAt);
    const next = j.stops[i + 1];
    if (next) shiftStops(j, i + 1, TUTORIAL_LEG_MS - (next.arriveAt - stop.departAt));
    forgetMotion(jid);
    run.tutorialHeld = false;
  }
}

/** the departure of stop `i` moves, and every stop after it with it; its
 * arrival stays where it was, the train is already at the platform */
function holdDeparture(j: { stops: { arriveAt: number; departAt: number }[] }, i: number, deltaMs: number) {
  j.stops[i].departAt += deltaMs;
  shiftStops(j as Parameters<typeof shiftStops>[0], i + 1, deltaMs);
}
