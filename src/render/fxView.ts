import Phaser from 'phaser';
import type { Fx } from '../combat/fx.ts';
import * as C from '../config.ts';

/**
 * Draws what the simulation said happened.
 *
 * The queue is drained each frame and nothing here is read back: a client
 * could skip every one of these and still be in step with the other three,
 * which is the property that lets the same simulation run headless (§11c).
 *
 * ---- why this is a pool and not a tween ----
 *
 * Every burst used to be a new Arc plus a new Tween, destroyed on
 * completion. In a real fight, fifty on the floor, chains arcing, that is
 * a hundred live tweens and a hundred objects created and thrown away every
 * second: measured at 24 ms a frame with only 62 draw calls, so the cost was
 * all churn (2026-09-05). Now a burst is a row in an array drawn by a pooled
 * image of one shared texture, advanced by hand. No allocation, no tweens,
 * and every burst on screen batches into one draw call.
 */

interface Live {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  grow: number;
  alpha: number;
  ms: number;
  born: number;
}

export class FxView {
  private readonly live: Live[] = [];
  private readonly pool: Phaser.GameObjects.Image[] = [];
  /** every chain drawn this frame, on one Graphics rather than one apiece */
  private readonly chains: Phaser.GameObjects.Graphics;
  private readonly pending: { fx: Fx; at: number }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.chains = scene.add.graphics().setDepth(6.4).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** the queue, drawn: every point in it is a place on the map */
  drain(queue: Fx[]) {
    const now = this.scene.time.now;
    for (const fx of queue) this.play(fx, now);
    queue.length = 0;
    this.advance(now);
  }

  private take(): Phaser.GameObjects.Image {
    const hit = this.pool.pop();
    if (hit) return hit.setVisible(true).setActive(true);
    return this.scene.add.image(0, 0, 'fx-disc');
  }

  private play(fx: Fx, now: number) {
    if (fx.kind === 'shake') {
      this.scene.cameras.main.shake(fx.ms, fx.power);
      return;
    }
    if (fx.kind === 'chain') {
      this.pending.push({ fx: { ...fx, points: fx.points.slice() }, at: now + fx.delay });
      return;
    }
    if (fx.kind === 'text') {
      // a few words, rising a metre and fading in 0.8 s
      const t = this.scene.add
        .text(fx.x, fx.y, fx.text, {
          fontFamily: 'Barlow, Helvetica, Arial, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          color: fx.color,
          stroke: '#0b0f16',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(6.6);
      this.scene.tweens.add({
        targets: t,
        y: fx.y - C.M(1.2),
        alpha: 0,
        duration: 800,
        onComplete: () => t.destroy(),
      });
      return;
    }
    const x = fx.x;
    const y = fx.y;
    const img = this.take();
    img
      .setPosition(x, y)
      .setDepth(fx.depth)
      .setTint(fx.color)
      .setAlpha(fx.alpha)
      .setScale((fx.r * 2) / 64);
    this.live.push({
      img,
      x,
      y,
      dx: fx.dx,
      dy: fx.dy,
      r: fx.r,
      grow: fx.grow,
      alpha: fx.alpha,
      ms: Math.max(1, fx.ms),
      born: now,
    });
  }

  /** move every burst on by hand, and retire the ones that are done */
  private advance(now: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const b = this.live[i];
      const t = (now - b.born) / b.ms;
      if (t >= 1) {
        b.img.setVisible(false).setActive(false);
        this.pool.push(b.img);
        this.live.splice(i, 1);
        continue;
      }
      const scale = (b.r * 2 * (1 + (b.grow - 1) * t)) / 64;
      b.img
        .setPosition(b.x + b.dx * t, b.y + b.dy * t)
        .setScale(scale)
        .setAlpha(b.alpha * (1 - t));
    }
    // the chains: every one due this frame, on one Graphics
    this.chains.clear();
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (now < p.at) continue;
      if (now > p.at + 160) {
        this.pending.splice(i, 1);
        continue;
      }
      const fx = p.fx;
      if (fx.kind !== 'chain') continue;
      this.chains.lineStyle(2, fx.color, Math.max(0, 1 - (now - p.at) / 160));
      this.chains.beginPath();
      for (let k = 0; k < fx.points.length; k += 2) {
        if (k === 0) this.chains.moveTo(fx.points[k], fx.points[k + 1]);
        else this.chains.lineTo(fx.points[k], fx.points[k + 1]);
      }
      this.chains.strokePath();
    }
  }
}
