import Phaser from 'phaser';
import * as C from '../config.ts';
import * as DEPTH from './depth.ts';
import { doorNormalOf, railTrainOf } from '../world/metal.ts';
import type { Run } from '../sim/run.ts';

/**
 * DOORS THAT OPEN, on the map.
 *
 * A car's art is baked once per stock, doors SHUT, because a train only has
 * moving doors for the few seconds it stands at a platform
 * (render/trainArt.ts), everywhere else the leaves are part of the texture.
 * The station view has always drawn the moving leaves on top
 * (render/trainView.ts); the map view had nothing, so on the map the doors
 * never opened at all (from play 2026-09-10) even while the simulation let
 * bodies through them.
 *
 * So this is the same few rectangles, laid on the line instead of on a
 * horizontal track: the opening is the car's dark interior showing through
 * the bodywork, and the two leaves slide back into their pockets either side
 * of it. Drawn from `t.doorFrac`, which is the same number the floor asks
 * when it decides whether a body fits through (core/train.ts passableAtRel).
 */
export class MapDoors {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // just above the cars, and with them: a doorway is part of the train, and
    // the train is an actor (render/depth.ts)
    this.g = scene.add.graphics().setDepth(DEPTH.ACTOR_MIN + 0.02);
  }

  clear() {
    this.g.clear();
  }

  /**
   * The doors of one train, given a way of asking where a distance along it
   * lands on the map (world/trains2d.ts trainCars).
   */
  draw(
    run: Run,
    jid: string,
    now: number,
    at: (along: number) => { x: number; y: number; tx: number; ty: number } | null,
  ) {
    const t = railTrainOf(run, jid);
    if (!t || !t.active() || t.doorFrac <= 0) return;
    // the same few rectangles the station view has always drawn
    // (render/trainView.ts), laid on the line instead of on a horizontal
    // track: a lit opening where the doorway is, and two leaves that shrink
    // into their pockets either side of it. The opening is LIT, a black gap
    // reads as a hole in the world, not as a door you may walk through (from
    // play 2026-09-11: "just a black hole for open train doors").
    const side = doorNormalOf(run, jid, now);
    const lat = side * (C.CAR_WIDTH / 2 - 3);
    const th = 8;
    const frac = t.doorFrac;
    for (const d of t.doors) {
      const w = d.x1 - d.x0;
      const p = at((d.x0 + d.x1) / 2);
      if (!p) continue;
      this.g.save();
      this.g.translateCanvas(p.x, p.y);
      this.g.rotateCanvas(Math.atan2(p.ty, p.tx));
      this.g.fillStyle(frac > 0.05 ? 0xa8dcff : 0x33404c, 1);
      this.g.fillRect(-w / 2, lat - th / 2, w, th);
      const closed = ((1 - frac) * w) / 2;
      if (closed > 0.5) {
        this.g.fillStyle(0x1f78c8, 1);
        this.g.fillRect(-w / 2, lat - th / 2, closed, th);
        this.g.fillRect(w / 2 - closed, lat - th / 2, closed, th);
      }
      this.g.restore();
    }
  }
}
