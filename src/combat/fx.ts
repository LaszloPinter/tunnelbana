/**
 * One-shot effects, as data.
 *
 * The last thing the simulation was doing to the renderer. Sparks, rings,
 * embers and screen shakes were created mid-step with `ctx.add.circle(...)`
 * and a tween, which meant the simulation could not run without Phaser, and
 * a snapshot of it could not be taken (§11c).
 *
 * They are events now: the simulation appends a small plain record saying
 * WHAT HAPPENED, and the renderer drains the queue each frame and decides what
 * that looks like. Nothing reads back from it, so a client that drew a
 * different number of sparks, or none at all, as a headless validator will,
 * still simulates the identical run.
 *
 * Deliberately a tiny vocabulary. Every effect in the game turned out to be a
 * circle that grows or rises and fades, a jagged line between two points, or
 * a thump of the camera.
 */

export type Fx =
  | {
      kind: 'burst';
      x: number;
      y: number;
      r: number;
      color: number;
      /** final scale, 1 to stay put */
      grow: number;
      /** how far it drifts as it fades */
      dx: number;
      dy: number;
      ms: number;
      alpha: number;
      depth: number;
    }
  | { kind: 'chain'; points: number[]; color: number; delay: number }
  | { kind: 'shake'; ms: number; power: number };

/** the queue never grows without bound, even when nothing is draining it */
export const FX_CAP = 256;

export function pushFx(queue: Fx[], fx: Fx) {
  if (queue.length >= FX_CAP) queue.shift();
  queue.push(fx);
}

/** a jolt of the camera, for a blow you threw or took */
export const shake = (ms: number, power: number): Fx => ({ kind: 'shake', ms, power });

/** a ring that expands and fades, the commonest shape in the game */
export const ring = (
  x: number,
  y: number,
  r: number,
  color: number,
  grow = 3,
  ms = 260,
  alpha = 0.55,
  depth = 6.35,
): Fx => ({ kind: 'burst', x, y, r, color, grow, dx: 0, dy: 0, ms, alpha, depth });

/** a spark that lifts and fades, for chips and embers */
export const ember = (
  x: number,
  y: number,
  r: number,
  color: number,
  rise = 10,
  ms = 300,
  alpha = 0.8,
  depth = 6.1,
): Fx => ({ kind: 'burst', x, y, r, color, grow: 1, dx: 0, dy: -rise, ms, alpha, depth });

/** a fleck thrown to a point and fading, for nova and dash trails */
export const fleck = (
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  color: number,
  ms = 300,
  alpha = 0.9,
  depth = 6.42,
): Fx => ({ kind: 'burst', x, y, r, color, grow: 1, dx, dy, ms, alpha, depth });
