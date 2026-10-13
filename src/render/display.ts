import Phaser from 'phaser';
import { deviceRatio } from '../config.ts';

/**
 * Size the canvas to the window in DEVICE pixels: the backing store is
 * innerWidth x dpr, the CSS box is innerWidth, and the scene's cameras zoom the
 * layout box up to fill it. Called at boot, on every window resize, and when
 * the render-scale cap is changed from the perf overlay.
 */
export function applyDeviceResolution(game: Phaser.Game) {
  const d = deviceRatio();
  if (Math.abs(game.scale.zoom - 1 / d) > 1e-6) game.scale.setZoom(1 / d);
  game.scale.resize(Math.round(window.innerWidth * d), Math.round(window.innerHeight * d));
}
