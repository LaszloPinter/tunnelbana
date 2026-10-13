import type Phaser from 'phaser';
import { turnCamera } from '../world/bearing.ts';
import { arrivalAt, arrivalTurn, arrivalZoom } from './arrival.ts';
import type { Player } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';

/**
 * WHERE THE VIEW IS POINTED, and how it got there.
 *
 * Two things that are really one: the map turns with the track under you
 * (world/bearing.ts), and a run OPENS by coming down onto you while that turn
 * settles (render/arrival.ts). They have to be one because the opening's
 * whole job is to make the settling part of a shot instead of a lurch.
 *
 * Kept out of the scene because the scene is a wiring loom, and this is a
 * decision about what the player is looking at.
 */
export class RunCamera {
  /** how far the view is turned, in the world's own terms */
  angle = 0;
  /** when this run's opening began, 0 once it is over */
  private opened = 0;

  /** a new run: come down onto the body from above */
  open(now: number) {
    this.opened = now;
  }

  /** is the opening still running? The world holds while it is, the shot is
   * the run's title card, and nothing should be eating you through it */
  opening(now: number): boolean {
    return this.opened > 0 && arrivalAt(this.opened, now) < 1;
  }

  /** how far through, nought to one, 1 when no opening is running */
  progress(now: number): number {
    return this.opened > 0 ? arrivalAt(this.opened, now) : 1;
  }

  /**
   * One frame of it. `playZoom` is the zoom the run plays at, the viewport's
   * own fit, so a window resized mid-descent still lands on the right one,
   * and `held` is a dev override that takes the camera off this entirely.
   */
  step(
    run: Run,
    me: Player,
    cam: Phaser.Cameras.Scene2D.Camera,
    now: number,
    playZoom: number,
    held: boolean,
  ) {
    const k = arrivalAt(this.opened, now);
    this.angle = turnCamera(run, me, this.angle, cam, arrivalTurn(k));
    if (this.opened <= 0 || held) return;
    if (k >= 1) this.opened = 0;
    cam.setZoom(arrivalZoom(playZoom, k));
  }

  /** the dev overrides, which take the camera off all of the above */
  dev(cam: Phaser.Cameras.Scene2D.Camera, zoom: number, at: { x: number; y: number } | null) {
    if (zoom > 0 && cam.zoom !== zoom) cam.setZoom(zoom);
    if (!at) return;
    cam.stopFollow();
    cam.centerOn(at.x, at.y);
  }

  /**
   * HOW FAR THE VIEW MAY ROAM. On the map there are no bounds: the art is a
   * city, and a bounded camera is clamped in UNROTATED axes, so a turned view
   * fights the clamp and pushes the body off centre.
   */
  bounds(cam: Phaser.Cameras.Scene2D.Camera) {
    cam.removeBounds();
  }

  /** the body the view rides: the local seat's own rig, followed smoothly */
  follow(cam: Phaser.Cameras.Scene2D.Camera, rig: { root: Phaser.GameObjects.Container } | undefined) {
    if (rig) cam.startFollow(rig.root, true, 0.15, 0.15);
  }
}
