import Phaser from 'phaser';
import * as C from '../config.ts';
import * as DEPTH from './depth.ts';
import { asLeg } from '../sim/place.ts';
import { fromLeg } from '../world/floor.ts';
import type { Run } from '../sim/run.ts';
import type { Box } from './mapMetal.ts';

/**
 * THE TUNNEL'S DARK, on the map.
 *
 * Its own file because it is its own layer: not the ground, which mapView
 * draws, and not a thing in the ground either. It sits at GLOOM, UNDER
 * everyone walking and riding through it, because "the dark dims the place,
 * never the people walking it" (render/depth.ts, and render/tunnelGloom.ts,
 * which is this same dark in the old world, at this same weight).
 *
 * Drawn over the top instead, at twice the weight, it blacked out the train
 * and everyone riding in it (from play 2026-09-11: "the inside of the train
 * is too dark during rides").
 */
const DARK = 0x02030a;
const FULL = 0.42;

export class MapGloom {
  private readonly g: Phaser.GameObjects.Graphics;
  private cam: Box | null = null;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.GLOOM);
  }

  destroy() {
    this.g.destroy();
  }

  /** is this point within the camera's reach, plus the margin the picture
   * may go stale by before it is redrawn */
  private inView(p: { x: number; y: number }): boolean {
    const c = this.cam;
    if (!c) return true;
    const pad = C.M(40);
    return p.x > c.x0 - pad && p.x < c.x1 + pad && p.y > c.y0 - pad && p.y < c.y1 + pad;
  }

  /** is any of this bore on screen? */
  private sees(leg: { cor: { pts: { x: number; y: number }[] } }): boolean {
    if (!this.cam) return true;
    const pad = C.M(120);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of leg.cor.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return (
      x1 + pad > this.cam.x0 && x0 - pad < this.cam.x1 && y1 + pad > this.cam.y0 && y0 - pad < this.cam.y1
    );
  }

  draw(run: Run, cam: Box | null) {
    this.cam = cam;
    const g = this.g;
    g.clear();
    for (const id of run.live) {
      const leg = asLeg(run.places.get(id));
      if (!leg || !this.sees(leg)) continue;
      const c = leg.cor;
      const STEP = C.M(10);
      for (let s = c.s0; s < c.s1; s += STEP) {
        const to = Math.min(s + STEP, c.s1);
        // only the stretch on camera, as the floor does (render/mapBore.ts)
        if (!this.inView(fromLeg(leg, s, 0))) continue;
        const mid = (s + to) / 2;
        const intoA = Math.min(mid - c.s0, c.s1 - mid);
        const k = Math.min(1, intoA / C.M(90));
        if (k <= 0.02) continue;
        const a0 = leg.arcBand(s);
        const a1 = leg.arcBand(to);
        const p0 = fromLeg(leg, s, a0.top);
        const p1 = fromLeg(leg, to, a1.top);
        const p2 = fromLeg(leg, to, a1.bottom);
        const p3 = fromLeg(leg, s, a0.bottom);
        g.fillStyle(DARK, FULL * k * k);
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        g.lineTo(p1.x, p1.y);
        g.lineTo(p2.x, p2.y);
        g.lineTo(p3.x, p3.y);
        g.closePath();
        g.fillPath();
      }
    }
  }
}
