import Phaser from 'phaser';
import * as C from '../config.ts';
import * as DEPTH from './depth.ts';
import type { Patch } from '../world/bake.ts';
import type { Chunks } from '../world/chunks.ts';
export { camRect } from './camRect.ts';
import { MapMetal } from './mapMetal.ts';
import { MapGloom } from './mapGloom.ts';
import { MapBore } from './mapBore.ts';

import type { Run } from '../sim/run.ts';

const EDGE = 0x5a5a68;
const DECK = 0x3a3a44;
const BED = 0x1e1e26;
const BORE = 0x14141a;

export class MapView {
  private readonly floor: Phaser.GameObjects.Graphics;
  /** the tunnel's dark: its own picture, at its own depth (mapGloom.ts) */
  private readonly gloom: MapGloom;
  /** the tunnels' own ground: rock, floor, rails, and the seam (mapBore.ts) */
  private readonly bore = new MapBore();
  /** the trains: their own picture, their own file (render/mapMetal.ts) */
  private readonly metal: MapMetal;
  /** the baked map this picture was made from; a new one means redraw */
  private drawnFrom: Chunks | null = null;
  /** ...and what the camera saw when it was made: where, and how much */
  private drawnAt: { x: number; y: number; w: number; h: number } | null = null;
  /** what the camera can see, so a bore off screen is not drawn at all */
  private cam: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.floor = scene.add.graphics().setDepth(DEPTH.GROUND);
    this.gloom = new MapGloom(scene);
    this.metal = new MapMetal(scene);
  }

  /**
   * THE GROUND, redrawn exactly when the ground changes.
   *
   * This is the picture of the baked floor, and it is kept rather than
   * re-emitted every frame because a curve is only expensive if you draw it
   * sixty times a second. What it must never do is go stale: the map rebakes
   * as a NEW object whenever anything about the world it describes changes
   * (src/world/live.ts), so that object IS the answer to "is this picture
   * still the right one". It used to be a hand-made key, how many patches,
   * which places were live, roughly where the camera was, and a key like
   * that has to be remembered and updated alongside every reason the floor
   * might move. It missed some, and a missed one leaves the floor drawn for a
   * world that no longer exists: the mesh runs to the mouth and the picture
   * of it stops short, which is the black band at every seam (from play,
   * over and over, until the debug overlay drew both at once).
   */
  private drawFloor(run: Run) {
    const map = run.map;
    const c = this.cam;
    const at = c ? { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, w: c.x1 - c.x0, h: c.y1 - c.y0 } : null;
    // ...or the view ZOOMED: the cull is baked into the picture, and a
    // zoom-out with the centre held showed the edge of what was drawn
    const was = this.drawnAt;
    const moved =
      !at || !was || Math.hypot(at.x - was.x, at.y - was.y) > C.M(15) || at.w !== was.w || at.h !== was.h;
    if (map === this.drawnFrom && !moved) return;
    this.drawnFrom = map;
    this.drawnAt = at;
    const g = this.floor;
    g.clear();
    const fill = (p: Patch, color?: number) => {
      g.fillStyle(color ?? (p.kind === 'platform' ? DECK : p.kind === 'bed' ? BED : BORE), 1);
      g.beginPath();
      g.moveTo(p.x[0], p.y[0]);
      for (let i = 1; i < 4; i++) g.lineTo(p.x[i], p.y[i]);
      g.closePath();
      g.fillPath();
    };
    // BORES FIRST, so a platform's deck sits over the mouth it shares with
    // one. Drawn from the curve, NOT from the baked collision mesh: that mesh
    // is cut every metre because a chord across a bend has to stay inside the
    // real wall to the centimetre (probe `baked`), and a picture needs
    // nothing of the kind. Drawing it was ~100,000 retained graphics commands
    // and cost two thirds of the frame rate (from play 2026-09-10, 22 fps).
    this.bore.floor(this.floor, run, this.cam);
    // ...and the seam at each mouth from the mesh itself, BEFORE the rooms go
    // over it: a station's deck owns the ground it shares with a bore
    this.bore.seam(this.floor, run);
    // ...and of the rooms, only what the camera can see, with the same
    // margin the picture may go stale by: a live station two stops away is
    // not on screen, and its floor was in the picture anyway
    const box = this.cam;
    const pad = C.M(40);
    const near = (p: Patch) =>
      !box || (p.x1 > box.x0 - pad && p.x0 < box.x1 + pad && p.y1 > box.y0 - pad && p.y0 < box.y1 + pad);
    for (const p of map.patches) if (p.kind !== 'bore' && near(p)) fill(p);
    // the platform edges: the line a body steps off
    g.lineStyle(2, EDGE, 0.8);
    for (const p of map.patches) {
      if (p.kind !== 'platform' || !near(p)) continue;
      g.beginPath();
      g.moveTo(p.x[0], p.y[0]);
      for (let i = 1; i < 4; i++) g.lineTo(p.x[i], p.y[i]);
      g.closePath();
      g.strokePath();
    }
    this.bore.rails(this.floor, run, this.cam);
    // the columns are the station's own (render/stationFurniture.ts), in its
    // posed picture; drawn here as well, a flat square sat over every one
    this.gloom.draw(run, this.cam);
  }

  draw(run: Run, now: number, cam?: { x0: number; y0: number; x1: number; y1: number }) {
    this.cam = cam ?? null;
    this.drawFloor(run);
    this.metal.draw(run, now, this.cam);
  }

  destroy() {
    this.metal.destroy();
    this.gloom.destroy();
    this.floor.destroy();
  }
}
