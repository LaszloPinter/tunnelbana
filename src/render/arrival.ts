/**
 * THE FIRST FEW SECONDS OF A RUN.
 *
 * The map has to settle when a run starts: the view begins square to the
 * screen and turns to lie along the platform you are standing on
 * (world/bearing.ts), which on its own is a lurch at the very moment you are
 * trying to read the place. So the run OPENS instead, high above the
 * station, turning level, coming down onto the body, and by the time the
 * settling is done it looks like the shot was always going to end there.
 *
 * It is only the camera. Nothing here is simulation, nothing is remembered
 * between frames but the moment it began, and interrupting it costs nothing.
 */
export const ARRIVAL_MS = 2400;

/** how far out the shot starts, as a fraction of the playing zoom */
const FROM = 0.34;

/** eased nought-to-one across the opening; 1 once it is over */
export function arrivalAt(started: number, now: number): number {
  if (started <= 0) return 1;
  const t = Math.max(0, Math.min(1, (now - started) / ARRIVAL_MS));
  // slow out of the descent rather than into it: the ground rushes up and
  // then eases, which is what falling toward something looks like
  return 1 - Math.pow(1 - t, 3);
}

/** the zoom to show at that moment, given the one the run plays at */
export function arrivalZoom(playing: number, k: number): number {
  return playing * (FROM + (1 - FROM) * k);
}

/**
 * How fast the view turns toward the world's bearing. It creeps while the
 * shot is coming down, so the turn is part of the descent and not a
 * separate event, and is the ordinary ease once play has started.
 */
export function arrivalTurn(k: number): number {
  return k >= 1 ? 0.12 : 0.06 + 0.1 * k;
}
