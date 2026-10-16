import Phaser from 'phaser';
import * as C from '../config.ts';
import { getRatioCap, setRatioCap } from '../config.ts';
import { applyDeviceResolution } from '../render/display.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import type { Run } from '../sim/run.ts';
import { isTouchDevice } from '../ui/dom/touch.ts';

/**
 * Fit the GAME_WIDTH x GAME_HEIGHT layout box into the device-pixel canvas:
 * both cameras get the same letterboxed viewport and the same zoom, so world
 * coordinates and HUD coordinates keep meaning exactly what they always did
 * while the picture is rendered at the screen's real resolution. Returns the
 * scale, which is also the resolution baked text needs.
 */
export function fitViewports(scene: Phaser.Scene, uiCam: Phaser.Cameras.Scene2D.Camera): number {
  const w = scene.scale.width;
  const h = scene.scale.height;
  const s = Math.min(w / C.GAME_WIDTH, h / C.GAME_HEIGHT);
  const vw = C.GAME_WIDTH * s;
  const vh = C.GAME_HEIGHT * s;
  const vx = (w - vw) / 2;
  const vy = (h - vh) / 2;
  // THE WORLD FILLS THE SCREEN, edge to edge: letterboxed with the HUD, a
  // phone's long screen had black bars down both sides (from play
  // 2026-10-16: "as full screen as possible, no black margins"). The world
  // camera takes the whole canvas at the same scale, and a phone sees it a
  // little closer (worldBoost). The HUD keeps its 16:9 box, centred.
  scene.cameras.main.setViewport(0, 0, w, h).setZoom(s * worldBoost());
  // the HUD camera is pinned to the layout box's top-left corner
  uiCam.setViewport(vx, vy, vw, vh).setZoom(s).setScroll(0, 0);
  return s;
}

/** how much closer a phone sees the world: a small screen, and thumbs */
export const worldBoost = (): number => (isTouchDevice() ? 1.3 : 1);

/**
 * G: cut the render resolution and put it back. A frame-rate problem is
 * either our own work (visible as sim/draw ms in the overlay) or the GPU
 * filling pixels, and dropping from a Retina 2x canvas to a 1x one is the
 * one experiment that tells the two apart in a second.
 */
export function cycleRenderScale(scene: Phaser.Scene): string {
  const caps = [1, 1.5, 3];
  const next = caps[(caps.indexOf(getRatioCap()) + 1) % caps.length] ?? 1;
  setRatioCap(next);
  applyDeviceResolution(scene.game);
  return `Render scale cap ${next === 3 ? 'device' : `${next}x`}: canvas ${scene.scale.width}x${scene.scale.height}`;
}

/** C: straight → real curve → exaggerated, rebuilding the station each time */
export function cycleCurve(sim: Run): string {
  sim.setCurve(sim.curveStrength === 0 ? 1 : sim.curveStrength === 1 ? 2.5 : 0);
  const geo = stationGeo(sim.station);
  return sim.curveStrength === 0
    ? 'Platform curve OFF (straight)'
    : `Platform curve ${sim.curveStrength}×: ${sim.station} bows ${(geo.bowM * sim.curveStrength).toFixed(1)} m`;
}

/**
 * THE INSTRUMENTS: F, G and C. Not controls, a frame-rate readout, a render
 * scale and the old platform bow, and they only exist in a dev build. Kept
 * out of the scene because a scene full of instruments reads as a scene that
 * does a lot, and this does none of the game's work.
 */
export function devKeys(s: {
  down: (k: 'F' | 'G' | 'C' | 'J') => boolean;
  debug: { toggle(): string };
  scene: Parameters<typeof cycleRenderScale>[0];
  sim: Parameters<typeof cycleCurve>[0];
  local: boolean;
  perf: { toggle(): void };
  say: (t: string) => void;
}) {
  if (s.down('J')) s.say(s.debug.toggle());
  if (s.down('F')) s.perf.toggle();
  if (s.down('G')) s.say(cycleRenderScale(s.scene));
  if (s.down('C'))
    // a ROOM SETTING under lockstep (aim bends through the curve)
    s.say(s.local ? cycleCurve(s.sim) : 'Curve is a room setting. The room must agree on it.');
}
