import Phaser from 'phaser';
import * as C from '../config.ts';
import * as DEPTH from './depth.ts';
import type { Station } from '../sim/station.ts';

/**
 * Headlights. A train coming up a tunnel throws light along it well before
 * the train itself is anything but a noise, which is most of what makes a
 * bore feel like somewhere you should not be standing. Drawn from the
 * leading end, widening down the bore, brighter the faster it is going and
 * dimmed right down alongside a lit platform where it would only wash the
 * place out. Above the tunnel's cover for the same reason a lit platform
 * is: the dark belongs to the tunnel, and a light in it is the point.
 */
export class HeadlightView {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.LIGHT).setBlendMode(Phaser.BlendModes.ADD);
  }

  destroy() {
    this.g.destroy();
  }

  /** the map drives its own frame (render/mapMetal.ts) */
  clear() {
    this.g.clear();
  }

  /**
   * ONE TRAIN'S BEAM, from its nose along the way the track is drawn. Said in
   * the map's terms, a distance from the train's tail, because all it ever
   * needed was a nose, a heading and a way of asking where a point along the
   * track lands (render/mapMetal.ts).
   */
  beam(
    speedPxS: number,
    dir: 1 | -1,
    nose: number,
    at: (x: number) => { x: number; y: number },
    outside: boolean,
    active = true,
  ) {
    const g = this.g;
    {
      if (!active) return;
      const speed = Math.abs(speedPxS);
      if (speed < C.M(0.5)) return;
      const t = { dir };
      const power = Math.min(1, speed / C.TRAIN_CRUISE) * (outside ? 1 : 0.25);
      if (power <= 0.02) return;
      const L = C.M(26) * (0.5 + 0.5 * Math.min(1, speed / C.TRAIN_CRUISE));
      const near = C.M(1.1);
      const far = C.M(3.4);
      // along the track as drawn, whichever way it bends: the beam runs
      // from the nose toward a point down the line, and widens across it
      const p0 = at(nose);
      const p1 = at(nose + t.dir * L);
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const nx = -(p1.y - p0.y) / len;
      const ny = (p1.x - p0.x) / len;
      const pm = { x: p0.x + (p1.x - p0.x) * 0.35, y: p0.y + (p1.y - p0.y) * 0.35 };
      const quad = (a: { x: number; y: number }, wa: number, b: { x: number; y: number }, wb: number) =>
        g.fillPoints(
          [
            new Phaser.Math.Vector2(a.x - nx * wa, a.y - ny * wa),
            new Phaser.Math.Vector2(b.x - nx * wb, b.y - ny * wb),
            new Phaser.Math.Vector2(b.x + nx * wb, b.y + ny * wb),
            new Phaser.Math.Vector2(a.x + nx * wa, a.y + ny * wa),
          ],
          true,
        );
      g.fillStyle(0xffe6b0, 0.16 * power);
      quad(p0, near, p1, far);
      // the lamps themselves, and a short hot core in front of them
      g.fillStyle(0xfff4d0, 0.85 * power);
      g.fillCircle(p0.x - nx * C.M(0.55), p0.y - ny * C.M(0.55), 3);
      g.fillCircle(p0.x + nx * C.M(0.55), p0.y + ny * C.M(0.55), 3);
      g.fillStyle(0xffeec0, 0.3 * power);
      quad(p0, near * 0.7, pm, C.M(1.5));
    }
  }
}

/**
 * Corruption: rolling darkness claiming the platform from both ends once
 * the second needed train has gone (§16). The frontier undulates, its rim
 * glows violet, and motes of the old world drift up out of it.
 */
export class CorruptionView {
  private readonly fill: Phaser.GameObjects.Graphics;
  private readonly rim: Phaser.GameObjects.Graphics;
  private readonly motes: { gfx: Phaser.GameObjects.Arc; seed: number }[] = [];

  constructor(scene: Phaser.Scene) {
    this.fill = scene.add.graphics().setDepth(1.6);
    this.rim = scene.add.graphics().setDepth(1.65).setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 0; i < 14; i++) {
      this.motes.push({
        gfx: scene.add
          .circle(0, 0, 1.5 + Math.random() * 2, 0x9a6cf0)
          .setDepth(1.7)
          .setAlpha(0)
          .setBlendMode(Phaser.BlendModes.ADD),
        seed: Math.random() * 1000,
      });
    }
  }

  /** `at` says where a point of the platform's own along-and-across is on
   * screen, on the map, its place in Stockholm (world/floor.ts
   * fromPlatform). Drawn in the room's own numbers through the identity, the
   * dark was painted at the origin and the player burned in a dark they
   * could not see (found in review, 2026-09-15). */
  draw(st: Station, now: number, at: (x: number, ly: number) => { x: number; y: number }) {
    const P = (x: number, ly: number) => {
      const q = at(x, ly);
      return new Phaser.Math.Vector2(q.x, q.y);
    };
    this.fill.clear();
    this.rim.clear();
    if (st.corruption <= 2) {
      for (const mote of this.motes) mote.gfx.setAlpha(0);
      return;
    }
    const yT = st.platforms[0].top;
    const yB = st.platforms[st.platforms.length - 1].bottom;
    for (const side of [0, 1] as const) {
      const frontier = side === 0 ? st.platformX0 + st.corruption : st.platformX1 - st.corruption;
      const dir = side === 0 ? 1 : -1;
      const backX = side === 0 ? st.platformX0 - C.M(6) : st.platformX1 + C.M(6);
      const pts: Phaser.Math.Vector2[] = [P(backX, yT)];
      for (let y = yT; y <= yB; y += 7) {
        const wave =
          Math.sin(y * 0.11 + now * 0.0035 + side * 9) * 6 + Math.sin(y * 0.043 - now * 0.0021) * 4;
        const px = frontier + dir * wave;
        pts.push(P(px, y));
      }
      pts.push(P(backX, yB));
      this.fill.fillStyle(0x140b20, 0.62);
      this.fill.fillPoints(pts, true);
      this.rim.lineStyle(2.5, 0x9a6cf0, 0.35 + Math.sin(now / 240) * 0.15);
      this.rim.strokePoints(pts.slice(1, -1), false);
    }
    // drifting motes inside the claimed ground
    this.motes.forEach((mote, i) => {
      const side = i % 2;
      const span = Math.max(4, st.corruption - 8);
      const mx =
        side === 0
          ? st.platformX0 + ((mote.seed * 37 + now * 0.006) % span)
          : st.platformX1 - ((mote.seed * 41 + now * 0.006) % span);
      const my = yB - ((mote.seed * 53 + now * 0.02 + i * 40) % (yB - yT));
      const q = at(mx, my);
      mote.gfx.setPosition(q.x, q.y).setAlpha(0.25 + Math.sin(now / 180 + mote.seed) * 0.2);
    });
  }

  destroy() {
    this.fill.destroy();
    this.rim.destroy();
    for (const m of this.motes) m.gfx.destroy();
  }
}
