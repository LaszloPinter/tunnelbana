import type { NextRide } from '../ui/dom/rideDone.ts';
import type { Run } from '../sim/run.ts';
import type { DemoScene } from './DemoScene.ts';

/** the ride the chain has dealt next, as the between-rides screen shows it */
export function nextRide(s: Run): NextRide {
  return { ride: s.ride + 1, from: s.rideFrom, to: s.destStation, route: s.route, banked: s.banked };
}

/**
 * THE BETWEEN-RIDES SCREEN FOLLOWS THE SIM: up while the world holds for
 * the party's go, gone the moment it does not. The victory is shown by the
 * host's `arrived`; a hold with nothing on screen (a save picked back up
 * between rides) goes straight to the ride to come.
 */
export function syncRideDone(scene: DemoScene) {
  const between = scene.sim.pause?.kind === 'ride' && !scene.sim.over && !scene.session.resuming;
  const rd = scene.rideDone;
  if (!between) {
    if (rd.visible) rd.hide();
    return;
  }
  if (!rd.visible) rd.showNext(nextRide(scene.sim));
  const k = scene.inputs;
  if (k.justDown('E') || k.justDown('ENTER') || k.padJustDown('A')) rd.advance();
}
