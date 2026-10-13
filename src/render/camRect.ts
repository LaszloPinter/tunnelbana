import type Phaser from 'phaser';
/**
 * WHAT A CAMERA CAN SEE, in world coordinates, and generously, because the
 * view TURNS with the world (src/world/bearing.ts). A turned camera's corners
 * reach further than its width and height in world axes do, so a box measured
 * as if it were upright hides things that are plainly on screen. Half the
 * diagonal covers it at any angle.
 *
 * ...ABOUT THE CAMERA'S MIDDLE, which is not scrollX + half a view. Phaser
 * looks at `scrollX + width / 2` (Camera.preRender midPoint) and shows
 * `width / zoom` around it, so at any zoom but 1 the view is NOT the box that
 * starts at scrollX: the world camera is zoomed by the viewport fit
 * (scenes/viewport.ts, ~1.2–3 on a real screen), and the box stood up and
 * left of the picture by (zoom − 1) / 2 of a view. Everything culled against
 * it vanished toward the bottom and right of the screen, trains popped in
 * already halfway across it, and on a big window the train you were riding
 * was culled out from under you while you rode on (from play 2026-09-26).
 */
export function camRect(c: Phaser.Cameras.Scene2D.Camera) {
  const cx = c.scrollX + c.width / 2;
  const cy = c.scrollY + c.height / 2;
  // half the view's diagonal, plus the distance the view may move before it
  // is next measured: this is read before Phaser's follow moves the scroll
  const r = Math.hypot(c.width / c.zoom, c.height / c.zoom) / 2 + 32;
  return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r };
}
