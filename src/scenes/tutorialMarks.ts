import type Phaser from 'phaser';
import * as C from '../config.ts';
import { fromPlatform } from '../world/floor.ts';
import { asStation } from '../sim/place.ts';
import { Station } from '../sim/station.ts';
import type { Run } from '../sim/run.ts';

/**
 * THE TUTORIAL'S MARKS IN THE WORLD: the pulsing "go here" ring the overlay
 * asks for (ui/dom/tutorial.ts marker), and Tutorialstorg's two barriers.
 */
export class TutorialMarks {
  private readonly ring: Phaser.GameObjects.Arc;
  /** Tutorialstorg's two barriers, drawn once per tutorial run */
  private fence: Phaser.GameObjects.Graphics | null = null;
  private fenceFor: unknown = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.ring = scene.add
      .circle(0, 0, C.M(1.5), 0xffd23f, 0.001)
      .setStrokeStyle(3, 0xffd23f, 0.9)
      .setDepth(6.4)
      .setVisible(false);
  }

  draw(sim: Run, mark: { x: number; y: number } | null, wallNow: number) {
    this.drawFence(sim);
    this.ring.setVisible(!!mark);
    if (mark) this.ring.setPosition(mark.x, mark.y).setScale(1 + 0.12 * Math.sin(wallNow / 160));
  }

  /**
   * TUTORIALSTORG'S ENDS, SHOWN: a striped barrier across every island and bed
   * at each end of the pen, so the wall you walk into is a thing you can see
   * (sim/tutorialTrain.ts tutorialPen, world/walk2d.ts outsidePen).
   */
  private drawFence(sim: Run) {
    const pen = sim.tutorial ? sim.tutorialPen : null;
    if (pen === this.fenceFor) return;
    this.fenceFor = pen;
    this.fence?.destroy();
    this.fence = null;
    if (!pen) return;
    const st = asStation(sim.places.get(Station.idOf(pen.station)));
    if (!st) return;
    const g = this.scene.add.graphics().setDepth(5.75);
    const stripe = C.M(0.8);
    for (const x of [pen.x0, pen.x1]) {
      for (let y = st.worldTopY; y < st.worldBottomY; y += stripe) {
        const a = fromPlatform(st, x, y);
        const b = fromPlatform(st, x, Math.min(st.worldBottomY, y + stripe));
        g.lineStyle(C.M(0.35), Math.floor(y / stripe) % 2 === 0 ? 0xffd23f : 0x14151c, 0.95);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
    this.fence = g;
  }
}
