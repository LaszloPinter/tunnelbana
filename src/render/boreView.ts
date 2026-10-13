import Phaser from 'phaser';
import * as C from '../config.ts';
import type { Leg } from '../sim/legPlace.ts';
import { EnemyView } from './enemyView.ts';
import { GroundViews } from './groundView.ts';
import { ProjectileView } from './projectileView.ts';
import { TelegraphView } from './telegraphView.ts';
import type { Box } from './mapMetal.ts';

/**
 * WHAT MOVES IN A BORE, on the map.
 *
 * A tunnel's own picture, its floor, its rails, its rock and its dark, is
 * the map's (render/mapView.ts, render/mapGloom.ts), drawn from the real
 * curve. What was missing is everything IN it: "the bores are not views at
 * all here" was true of the ground and quietly true of the horde, the shots,
 * the coins and the warnings as well. Nothing in a tunnel was drawn at all,
 * a vätte that followed you in vanished, and a bolt cast down there was never
 * seen (from play 2026-09-11).
 *
 * It is deliberately NOT render/legView.ts: that builds a whole tunnel's art
 * in the leg's own straight chart, which is the world the map replaced. This
 * holds the moving parts and nothing else, and every one of them is already a
 * place in Stockholm, so there is no chart to place them through.
 */
export class BoreView {
  readonly st: Leg;
  private readonly enemy: EnemyView;
  private readonly ground: GroundViews;
  private readonly proj: ProjectileView;
  private readonly telegraph: TelegraphView;
  private near = true;

  constructor(scene: Phaser.Scene, leg: Leg) {
    this.st = leg;
    this.enemy = new EnemyView(scene);
    this.ground = new GroundViews(scene);
    this.proj = new ProjectileView(scene);
    this.telegraph = new TelegraphView(scene);
  }

  /** the box the bore's own curve stands in, against the camera's */
  private sees(cam: Box | null): boolean {
    if (!cam) return true;
    const pad = C.M(80);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of this.st.cor.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return x1 + pad > cam.x0 && x0 - pad < cam.x1 && y1 + pad > cam.y0 && y0 - pad < cam.y1;
  }

  draw(now: number, cam: Box | null, upright: number, dark = 0) {
    if (!this.sees(cam)) {
      if (this.near) this.clear();
      this.near = false;
      return;
    }
    this.near = true;
    this.proj.sync(this.st, now);
    this.ground.sync(this.st, now);
    this.enemy.sync(this.st, now, upright, dark);
    this.telegraph.sync(this.st, now);
  }

  private clear() {
    this.proj.clear();
    this.ground.clear();
    this.enemy.clear();
    this.telegraph.clear();
  }

  destroy() {
    this.clear();
  }
}
