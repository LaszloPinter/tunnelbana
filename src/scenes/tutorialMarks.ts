import type Phaser from 'phaser';
import * as C from '../config.ts';
import { fromPlatform } from '../world/floor.ts';
import { asStation } from '../sim/place.ts';
import { Station } from '../sim/station.ts';
import type { Run } from '../sim/run.ts';
import type { DemoScene } from './DemoScene.ts';
import { GuideView, guideGoal } from './guide.ts';
import { STRIP_H } from './hudStatus.ts';
import { guideState, observeLessons, setGuide, wantsControls } from './guideState.ts';
import { setControlsHint } from '../ui/dom/controlsHint.ts';

/**
 * THE MARKS IN THE WORLD: the tutorial's pulsing "go here" ring (ui/dom/
 * tutorial.ts marker), Tutorialstorg's two barriers, and the live guide
 * that points the way for the rest of the game (scenes/guide.ts), toggled
 * with G.
 */
export class TutorialMarks {
  private readonly ring: Phaser.GameObjects.Arc;
  /** Tutorialstorg's two barriers, drawn once per tutorial run */
  private fence: Phaser.GameObjects.Graphics | null = null;
  private fenceFor: unknown = null;

  private readonly guide: GuideView;

  constructor(private readonly scene: DemoScene) {
    this.guide = new GuideView(scene, C.GAME_HEIGHT - STRIP_H - 64, C.GAME_WIDTH);
    this.ring = scene.add
      .circle(0, 0, C.M(1.5), 0xffd23f, 0.001)
      .setStrokeStyle(3, 0xffd23f, 0.9)
      .setDepth(6.4)
      .setVisible(false);
  }

  draw(sim: Run, mark: { x: number; y: number } | null, wallNow: number) {
    this.drawFence(sim);
    if (this.scene.inputs.justDown('G')) {
      setGuide(!guideState.on);
      this.scene.hostMsg(guideState.on ? 'Guide on (G)' : 'Guide off (G)');
    }
    observeLessons(sim);
    // the controls, when the player seems not to know them (guideState.ts)
    setControlsHint(!mark && wantsControls(sim));
    if (guideState.on && !mark) this.guide.draw(guideGoal(sim), this.scene.drawnAt(sim.me), wallNow);
    else this.guide.hide();
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
