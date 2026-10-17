import Phaser from 'phaser';
import { deviceRatio } from '../config.ts';
import { isTouchDevice } from '../ui/dom/touch.ts';

/**
 * SIDEWAYS: a phone held upright is played turned (from play 2026-10-16:
 * "we should not ask the user to rotate their screen; we should rotate it
 * ourselves"). The page stays portrait; the canvas is laid out landscape,
 * the window's height by its width, and turned a quarter clockwise by CSS,
 * so a phone turned to the left shows it upright. A browser that does go
 * landscape is drawn as it is.
 */
export const sideways = (): boolean => isTouchDevice() && window.innerHeight > window.innerWidth;

/**
 * Size the canvas to the window in DEVICE pixels: the backing store is
 * innerWidth x dpr, the CSS box is innerWidth, and the scene's cameras zoom the
 * layout box up to fill it. Called at boot, on every window resize, and when
 * the render-scale cap is changed from the perf overlay.
 */
export function applyDeviceResolution(game: Phaser.Game) {
  const d = deviceRatio();
  const sw = sideways();
  const w = sw ? window.innerHeight : window.innerWidth;
  const h = sw ? window.innerWidth : window.innerHeight;
  const root = document.documentElement;
  root.classList.toggle('tb-sideways', sw);
  // a short screen, as the game sees it: the end cards press themselves flat
  root.classList.toggle('tb-short', h < 500);
  root.style.setProperty('--tb-sw', `${window.innerWidth}px`);
  root.style.setProperty('--tb-sh', `${window.innerHeight}px`);
  if (Math.abs(game.scale.zoom - 1 / d) > 1e-6) game.scale.setZoom(1 / d);
  game.scale.resize(Math.round(w * d), Math.round(h * d));
}

/** a point on the screen, in the turned page's own (landscape) CSS pixels */
export function toStage(clientX: number, clientY: number): { x: number; y: number } {
  return sideways() ? { x: clientY, y: window.innerWidth - clientX } : { x: clientX, y: clientY };
}

/**
 * A TAP ON A TURNED CANVAS: Phaser maps the page to its canvas by an offset
 * and a scale, which a quarter turn breaks; turned, the point is taken into
 * the canvas's own landscape axes first (toStage), then into game pixels.
 */
export function installSidewaysInput(game: Phaser.Game) {
  const im = game.input as unknown as {
    transformPointer: (
      p: { position: { x: number; y: number }; prevPosition: { x: number; y: number } },
      x: number,
      y: number,
      wasMove: boolean,
    ) => void;
  };
  const orig = im.transformPointer.bind(im);
  im.transformPointer = (pointer, pageX, pageY, wasMove) => {
    if (!sideways()) return orig(pointer, pageX, pageY, wasMove);
    // page to screen: Safari scrolls a fixed page a little (its bars, its
    // bounce), and the turn is about the screen
    const s = toStage(pageX - window.scrollX, pageY - window.scrollY);
    const d = deviceRatio();
    pointer.prevPosition.x = pointer.position.x;
    pointer.prevPosition.y = pointer.position.y;
    pointer.position.x = s.x * d;
    pointer.position.y = s.y * d;
  };
}
