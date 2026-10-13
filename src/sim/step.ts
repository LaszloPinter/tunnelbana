import { stepAmbient, stepCombat } from '../combat/combat.ts';
import { stepPause, stepProgression } from '../combat/progression.ts';
import { driveTrains, freezeRails } from './fleetRealise.ts';
import { holdTutorialTrain } from './tutorialTrain.ts';
import { asStation } from './place.ts';
import { isFrozen, isOccupied, liveInOrder, stepPlaces } from './places.ts';
import { alivePlayers } from './player.ts';
import { populateIfFresh, stepRides } from './rideArrival.ts';
import type { Run } from './run.ts';
import { stepPlayer } from './walk.ts';
import { stepPassengers } from '../combat/passengers.ts';

/**
 * ONE STEP OF THE WHOLE WORLD, in the order four clients agree on: which
 * places are alive, their trains, the rides, the picks, every seat, then
 * every live place's own fight. Split out of Run, which holds the state and
 * the tick; what HAPPENS is functions over it.
 */
export function stepRun(run: Run, dt: number, now: number) {
  // WHO IS WHERE decides what is alive this tick (places.ts): every place
  // within reach realises its trains and is populated, so the station up
  // the tunnel is whole before it is seen
  stepPlaces(run, now);
  for (const id of run.driven) {
    const st = run.live.has(id) ? null : asStation(run.places.get(id));
    if (st) freezeRails(st);
  }
  run.driven = new Set(run.live);
  // the tutorial's train waits at the platform for the player (sim/tutorialTrain.ts)
  if (run.tutorial) holdTutorialTrain(run, now);
  // only a station has metal to drive and a first wave to put on its floor
  for (const st of run.stations()) {
    if (isFrozen(run, st)) continue;
    driveTrains(run, st, now);
    if (!run.over && !run.briefing) populateIfFresh(run, st, now);
  }
  stepRides(run, now);

  // a finished run and the pre-run briefing hold the world
  if (run.over || run.briefing) return;

  // level-ups, class moments and the kiosk: the offer is rolled here, the
  // pick arrives as input. While the world stands still for it, sim time
  // is held (advance) and nothing below this line runs.
  for (const p of alivePlayers(run.players)) stepProgression(run.hostFor(run.placeOf(p)), p, now);
  stepPause(run.hostFor(run.here));
  if (run.pause) return;

  // every seat moves, in seat order, the order four clients agree on
  for (const p of alivePlayers(run.players)) {
    if (!stepPlayer(run, p, dt, now)) return;
  }
  // ...then the passengers, in the order they were made (DESIGN §20)
  stepPassengers(run, dt, now);

  // Every live place, in a fixed order. A host's players include whoever
  // walked off one of its ends into a leg (placeHost.refresh), so they
  // fight out there; the station's WAVES still wait for a foot on the
  // platform. A place within reach but empty merely lives: its horde
  // wanders, its loot lies, nothing escalates.
  for (const st of liveInOrder(run)) {
    if (isFrozen(run, st)) continue;
    const host = run.hostFor(st);
    if (host.players.length > 0) stepCombat(host, dt, now, isOccupied(run, st));
    else stepAmbient(host, dt, now);
  }
}
