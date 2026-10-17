import type Phaser from 'phaser';
import * as C from '../config.ts';
import { deviceRatio } from '../config.ts';
import type { ChoiceScreen } from '../ui/overlays.ts';
import { isTouchDevice } from '../ui/dom/touch.ts';

/**
 * THE PICK SCREENS ON A PHONE (from play 2026-10-17, an iPhone: "the choices
 * are not getting the touch, I'm stuck on that screen", and "this perk
 * picker is really tiny"). Two things, phones only:
 *
 *  - BIGGER: a pick, the kiosk or the bag is scaled up about the middle of
 *    the screen, as far as it fits, the moment it opens.
 *  - TAPPED BY US: a tap is not left to the canvas's own touch handling,
 *    which a turned page and Safari's scrolling could miss. A layer over the
 *    game takes it while such a screen is open, turns the finger's point
 *    into the HUD's own layout, and fires the topmost thing there that is
 *    waiting for a tap (its 'pointerup', as a click would).
 */
interface Host {
  choosing: ChoiceScreen | null;
  cameras: Phaser.Cameras.Scene2D.CameraManager;
  input: Phaser.Input.InputPlugin;
}

const grown = new WeakSet<ChoiceScreen>();
let layer: HTMLDivElement | null = null;

export function touchPick(scene: Host) {
  if (!isTouchDevice()) return;
  const ch = scene.choosing;
  if (ch && !grown.has(ch)) {
    grown.add(ch);
    grow(ch);
  }
  ensureLayer(scene);
  layer?.classList.toggle('is-on', !!ch && hasTaps(ch));
}

/** anything on this screen waiting for a tap */
function hasTaps(ch: ChoiceScreen): boolean {
  return ch.gfx.some(
    (g) => !!(g as unknown as { input?: unknown }).input && g.listenerCount('pointerup') > 0,
  );
}

/** scale the whole screen about the layout's middle, as far as it fits */
function grow(ch: ChoiceScreen) {
  type Obj = Phaser.GameObjects.GameObject & {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    setScale?: (x: number, y: number) => unknown;
    getBounds?: () => { x: number; y: number; width: number; height: number };
  };
  const objs = ch.gfx as Obj[];
  const cx = C.GAME_WIDTH / 2;
  const cy = C.GAME_HEIGHT / 2;
  // what is ON the screen (the full-screen dimmer excluded): its extent
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const o of objs) {
    const b = o.getBounds?.();
    if (!b || b.width >= C.GAME_WIDTH * 0.95) continue;
    x0 = Math.min(x0, b.x);
    x1 = Math.max(x1, b.x + b.width);
    y0 = Math.min(y0, b.y);
    y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0)) return;
  const half = Math.max(cx - x0, x1 - cx, 1);
  const halfY = Math.max(cy - y0, y1 - cy, 1);
  const k = Math.min(1.45, (C.GAME_WIDTH / 2 - 16) / half, (C.GAME_HEIGHT / 2 - 12) / halfY);
  if (k <= 1.02) return;
  for (const o of objs) {
    if (typeof o.x !== 'number' || !o.setScale) continue;
    o.x = cx + (o.x - cx) * k;
    o.y = cy + (o.y - cy) * k;
    o.setScale(o.scaleX * k, o.scaleY * k);
  }
  // the pad's cursor reads the slots: they grow with the rest
  for (const s of ch.slots) {
    s.x = cx + (s.x - cx) * k;
    s.y = cy + (s.y - cy) * k;
    s.w *= k;
    s.h *= k;
  }
}

/** a finger in the turned stage's own CSS pixels */
function stageOf(e: PointerEvent): { x: number; y: number } {
  return document.documentElement.classList.contains('tb-sideways')
    ? { x: e.clientY, y: window.innerWidth - e.clientX }
    : { x: e.clientX, y: e.clientY };
}

/** a stage point in the HUD's layout: the canvas's pixels, then the HUD camera's */
function layoutOf(scene: Host, css: { x: number; y: number }): { x: number; y: number } {
  const d = deviceRatio();
  // the HUD's camera: the scene's one that is not the world's
  const cam = scene.cameras.cameras.find((c) => c !== scene.cameras.main) ?? scene.cameras.main;
  return { x: (css.x * d - cam.x) / cam.zoom, y: (css.y * d - cam.y) / cam.zoom };
}

/** the topmost thing at a layout point waiting for a tap, or that can be dragged */
function topAt(
  ch: ChoiceScreen,
  x: number,
  y: number,
  want: 'tap' | 'drag',
): Phaser.GameObjects.GameObject | null {
  type In = { input?: { enabled?: boolean; draggable?: boolean }; depth?: number };
  const hits = ch.gfx.filter((g) => {
    const o = g as unknown as In & { getBounds?: () => { contains: (x: number, y: number) => boolean } };
    if (!o.input || o.input.enabled === false || !o.getBounds?.().contains(x, y)) return false;
    return want === 'drag' ? !!o.input.draggable : g.listenerCount('pointerup') > 0;
  });
  hits.sort((a, b) => ((b as unknown as In).depth ?? 0) - ((a as unknown as In).depth ?? 0));
  return hits[0] ?? null;
}

/** the layer that takes a tap while a pick is open, inside the turned overlay */
function ensureLayer(scene: Host) {
  if (layer) return;
  const touchRoot = document.getElementById('tb-touch');
  if (!touchRoot) return;
  layer = document.createElement('div');
  layer.className = 'tb-tap-layer';
  touchRoot.appendChild(layer);
  // a finger that stays put is a tap; one that moves from a card that can be
  // dragged (the travelcard's tickets, to reorder) is a drag onto where it lifts
  let down: {
    at: { x: number; y: number };
    css: { x: number; y: number };
    on: Phaser.GameObjects.GameObject | null;
  } | null = null;
  layer.addEventListener('pointerdown', (e) => {
    const ch = scene.choosing;
    if (!ch) return;
    const css = stageOf(e);
    const at = layoutOf(scene, css);
    down = { at, css, on: topAt(ch, at.x, at.y, 'drag') };
  });
  layer.addEventListener('pointerup', (e) => {
    const ch = scene.choosing;
    const from = down;
    down = null;
    if (!ch) return;
    const css = stageOf(e);
    const at = layoutOf(scene, css);
    const moved = from ? Math.hypot(css.x - from.css.x, css.y - from.css.y) > 18 : false;
    if (moved && from?.on) {
      // the scene's own drop: it asks the pointer what is under it
      const d = deviceRatio();
      const p = scene.input.activePointer;
      p.position.set(css.x * d, css.y * d);
      from.on.emit('pointerdown', p);
      from.on.emit('dragstart', p);
      from.on.emit('dragend', p);
      from.on.emit('pointerup', p);
      return;
    }
    const top = topAt(ch, at.x, at.y, 'tap');
    if (!top) return;
    top.emit('pointerdown');
    top.emit('pointerup');
  });
}
