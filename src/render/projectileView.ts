import Phaser from 'phaser';

import type { Place } from '../sim/place.ts';

/**
 * The pictures of the bolts in flight, and the trails behind them.
 *
 * ---- why this exists ----
 *
 * A projectile used to carry its own Phaser image: `p.gfx`. That made the
 * simulation's state un-cloneable, and a snapshot of a run is exactly a clone
 * of its state (§11c), so recovery, replay validation and headless testing
 * were all blocked on the same thing. The simulation now holds plain numbers
 * and this holds the pictures, matched by id.
 *
 * The pattern is the one every entity will move to: the view keeps a map from
 * entity id to game object, and each frame it creates what appeared, moves
 * what remains and destroys what is gone. Nothing in here is allowed to feed
 * back into the simulation, a trail is decoration, and decoration must never
 * be something a client could disagree about.
 */
export class ProjectileView {
  private readonly views = new Map<number, Phaser.GameObjects.Image>();
  /** A DARK RING UNDER EVERY BOLT. The glow is drawn additively, which is
   * what makes it burn on the platform's dark floor, and what made it
   * vanish on a car: added onto light-grey bodywork it was a white speck
   * (from play 2026-09-24: "my shots are not visible on trains"). A plain
   * dark disc beneath reads on either, and costs nothing on the floor,
   * where it is dark on dark. */
  private readonly halos = new Map<number, Phaser.GameObjects.Arc>();
  /** trails are pure decoration, so their timing lives here, not in the sim */
  private readonly nextTrailAt = new Map<number, number>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(st: Place, now: number) {
    const live = new Set<number>();
    for (const p of st.projs) {
      live.add(p.id);
      const at = { x: p.x, y: st.worldY(p.x, p.y) };
      let img = this.views.get(p.id);
      if (!img) {
        img = this.scene.add
          .image(at.x, at.y, p.pierce > 0 ? 'slug-glow' : 'bolt-glow')
          .setTint(p.color)
          .setDepth(6.2)
          .setBlendMode(Phaser.BlendModes.ADD);
        // the horde's spit is drawn big: a glob you can see coming and dodge
        // (from play, at bolt size it was a message and a number)
        if (!p.friendly) img.setScale(2.1);
        else if (p.heavy) img.setScale(2.8);
        this.views.set(p.id, img);
        const r = !p.friendly ? 9 : p.heavy ? 11 : p.pierce > 0 ? 7 : 6;
        this.halos.set(p.id, this.scene.add.circle(at.x, at.y, r, 0x05070a, 0.7).setDepth(6.19));
      }
      img.setPosition(at.x, at.y).setRotation(Math.atan2(p.vy, p.vx));
      this.halos.get(p.id)?.setPosition(at.x, at.y);

      if (p.friendly) {
        const due = this.nextTrailAt.get(p.id) ?? 0;
        if (now >= due) {
          this.nextTrailAt.set(p.id, now + 70);
          const dot = this.scene.add
            .circle(at.x, at.y, 2.4, p.color)
            .setDepth(6.1)
            .setAlpha(0.4)
            .setBlendMode(Phaser.BlendModes.ADD);
          this.scene.tweens.add({
            targets: dot,
            alpha: 0,
            scale: 0.4,
            duration: 200,
            onComplete: () => dot.destroy(),
          });
        }
      }
    }
    for (const [id, img] of this.views) {
      if (live.has(id)) continue;
      img.destroy();
      this.views.delete(id);
      this.halos.get(id)?.destroy();
      this.halos.delete(id);
      this.nextTrailAt.delete(id);
    }
  }

  /** a run ended or a station swallowed everything: drop the lot */
  clear() {
    for (const img of this.views.values()) img.destroy();
    this.views.clear();
    for (const h of this.halos.values()) h.destroy();
    this.halos.clear();
    this.nextTrailAt.clear();
  }
}
