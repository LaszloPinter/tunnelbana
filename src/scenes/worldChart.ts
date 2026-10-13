import type Phaser from 'phaser';
import type { Run } from '../sim/run.ts';
import { asLeg, asStation } from '../sim/place.ts';
import { frameOf } from '../core/worldNet.ts';
import { camRect } from '../render/camRect.ts';
import { PlaceView } from '../render/placeView.ts';
import { BoreView } from '../render/boreView.ts';
import { rideDark } from '../sim/chain.ts';
import { PassengerView } from '../render/passengerView.ts';

/**
 * THE PLACES ON SCREEN. Every live platform stands where it stands in
 * Stockholm, facing the way it faces, and every live bore has a view for what
 * MOVES in it; the ground itself is the map's picture (render/mapView.ts).
 * Each place has a view, kept while the place is live and torn down when it
 * is not, a Phaser object goes on drawing itself whether or not anything
 * still updates it.
 */

type View = PlaceView | BoreView;

export class WorldChart {
  private readonly views = new Map<string, View>();
  /** the people who are not the horde (DESIGN §20) */
  private pax: PassengerView | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly res: number,
  ) {}

  /**
   * Make the pictures match the sim: which places, and where each stands.
   * The art is the same art, built once in the station's own
   * along-and-across, then carried bodily to its place in Stockholm.
   */
  sync(run: Run) {
    const want = new Set<string>();
    for (const id of run.live) {
      // A BORE HAS A VIEW HERE TOO, not for its ground, which the map draws
      // from the real curve, but for what MOVES in it (render/boreView.ts).
      // Skipping legs outright meant a tunnel drew nothing at all: no horde,
      // no shots, no coins, no warnings (from play 2026-09-11).
      const asLegHere = asLeg(run.places.get(id));
      if (asLegHere) {
        want.add(id);
        let lv = this.views.get(id);
        if (lv && !(lv instanceof BoreView)) {
          lv.destroy();
          this.views.delete(id);
          lv = undefined;
        }
        if (!lv) this.views.set(id, new BoreView(this.scene, asLegHere));
        continue;
      }
      const st = asStation(run.places.get(id));
      if (!st || !st.plan) continue;
      want.add(id);
      let v = this.views.get(id);
      if (v && (!(v instanceof PlaceView) || v.st !== st || v.gen !== st.buildGen)) {
        v.destroy();
        this.views.delete(id);
        v = undefined;
      }
      if (!v) {
        v = new PlaceView(this.scene, this.res, run, st);
        this.views.set(id, v);
      }
      const f = frameOf(st.name, st.levelIndex);
      if (!f) continue;
      // the room is posed about its ANCHOR, the point its plan is written
      // around, which is what lets it be shown from either end (placeView.ts)
      (v as PlaceView).poseAt(f.x, f.y, Math.atan2(f.uy, f.ux));
    }
    for (const [id, v] of this.views) {
      if (want.has(id)) continue;
      v.destroy();
      this.views.delete(id);
    }
  }

  /** the layout changed which rail slots exist somewhere */
  railsChanged() {
    for (const v of this.views.values()) if (v instanceof PlaceView) v.railsChanged();
  }

  /** every frame: the moving parts of every place near the camera */
  draw(run: Run, now: number, cam: Phaser.Cameras.Scene2D.Camera) {
    // WHAT THE CAMERA CAN SEE, allowing for the fact that it TURNS with the
    // world (render/camRect.ts). Measured as an upright box, scrollX to
    // scrollX+width, a rotated view hides things that are plainly on screen:
    // a station's whole picture, its horde, its trains and its shots, while
    // the map's own floor underneath went on being drawn, because the floor
    // already asked this the right way. It shows worst when the view is
    // zoomed out and turned at once, which is exactly a run's opening shot
    // (from play 2026-09-12: "an empty skeleton rotating and zooming").
    const box = camRect(cam);
    // ART WITH AN UP is turned to come out LEVEL on screen, and the camera's
    // rotation is what the screen adds: an object at world rotation R is
    // drawn at R + cam.rotation, so the one that reads level is its
    // negative. Handing the camera's own angle over turned everything twice
    // instead of not at all (from play 2026-09-10).
    const upright = -(cam as unknown as { rotation: number }).rotation;
    // the horde goes darker every ride of the chain (sim/chain.ts)
    const dark = rideDark(run.ride);
    (this.pax ??= new PassengerView(this.scene)).draw(run, now, box, upright);
    for (const v of this.views.values()) {
      if (v instanceof BoreView) v.draw(now, box, upright, dark);
      else {
        v.upright = upright;
        v.dark = dark;
        v.draw(now, box.x0, box.x1, box.y0, box.y1, run.players);
      }
    }
  }
}
