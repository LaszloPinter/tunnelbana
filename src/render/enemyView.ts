import Phaser from 'phaser';
import type { Enemy } from '../combat/types.ts';
import type { Place } from '../sim/place.ts';
import { EnemyRig } from './enemyRig.ts';
import { drawWards } from './shieldView.ts';
import { drawCharges } from './chargeView.ts';
import { aboardPoint } from '../world/trainSeat.ts';

/**
 * The pictures of the horde.
 *
 * Enemies were the last entity to own their own graphics, and the most
 * tangled: the rig has animation state, stride phase, which way it faces,
 * how it flinches, and the simulation was keeping some of that for it.
 * `faceAngle`, `lastDrawX` and `lastDrawY` were fields on the enemy, which is
 * to say the simulation was remembering where a thing had been DRAWN. None of
 * that survives here; the view watches positions and works it out.
 *
 * Two moments used to be pushed by the simulation and are now PULLED by the
 * view, which is why this needed no event bus:
 *
 *   A hit. The view remembers each enemy's hp from last frame, so a drop is
 *   visible without being told, flash, and a chip of stone if it is armoured.
 *
 *   A death. The view already knows every id it is drawing, so an id that
 *   stops appearing has died; it plays the poof at the last place it stood and
 *   lets the tween own the rig from then on.
 *
 * That keeps the rule the split is for: the simulation holds facts, and no
 * part of it can be made to disagree between four machines by something as
 * cosmetic as a spark.
 */
export class EnemyView {
  private readonly rigs = new Map<number, EnemyRig>();
  private readonly seen = new Map<
    number,
    {
      x: number;
      y: number;
      hp: number;
      angle: number;
      hitCd: number;
      spitAt: number;
      at: number;
      frame: string;
    }
  >();

  /** every ward on the floor, one picture (render/shieldView.ts) */
  private readonly wards: Phaser.GameObjects.Graphics;
  /** the charges on every body (render/chargeView.ts) */
  private readonly charges: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    this.wards = scene.add.graphics().setDepth(6.45).setBlendMode(Phaser.BlendModes.ADD);
    this.charges = scene.add.graphics().setDepth(6.44).setBlendMode(Phaser.BlendModes.ADD);
  }

  /** draw the horde where it stands: on the map a body is already where it
   * is, riding or standing */
  sync(st: Place, now: number, upright = 0, dark = 0) {
    drawWards(this.wards, st.enemies, upright);
    drawCharges(this.charges, st.enemies, now);
    const live = new Set<number>();
    for (const e of st.enemies) {
      live.add(e.id);
      const drawX = e.x;
      const drawY = e.y;
      let rig = this.rigs.get(e.id);
      let was = this.seen.get(e.id);
      if (!rig) {
        rig = new EnemyRig(this.scene, drawX, drawY, e.type, e.sizeMul, e.variant);
        this.rigs.set(e.id, rig);
        was = { x: e.x, y: e.y, hp: e.hp, angle: 0, hitCd: e.hitCdUntil, spitAt: 0, at: now, frame: '' };
        this.seen.set(e.id, was);
      }
      const prev = was!;
      // its OWN motion, in its own frame: aboard a car the legs move only
      // when it walks the aisle, not when the train carries it (from play)
      const fx = e.frame.kind === 'aboard' ? e.frame.rx : e.x;
      const fy = e.frame.kind === 'aboard' ? e.frame.ry : e.y;
      const frameKey = e.frame.kind === 'aboard' ? `t${e.frame.ti}` : 'w';
      const dx = frameKey === prev.frame ? fx - prev.x : 0;
      const dy = frameKey === prev.frame ? fy - prev.y : 0;
      const moved = Math.hypot(dx, dy);
      const dtMs = Math.max(1, now - prev.at);
      // px per second over the platform: the stride is paced to it
      const speed = (moved / dtMs) * 1000;
      // it faces the way it is going, and keeps facing that way when it stops.
      // ABOARD that heading is in the car's own along-and-across, and the car
      // lies at whatever bearing its line runs: the frame angle is kept, and
      // said in the world through the seat each frame (from play 2026-09-21:
      // the spider "walking towards me facing elsewhere")
      const fa = moved > 0.15 ? Math.atan2(dy, dx) : prev.angle;
      let angle = fa;
      if (e.frame.kind === 'aboard' && e.frame.jid) {
        const o = aboardPoint(e.frame.jid, fx, fy, now);
        const q = aboardPoint(e.frame.jid, fx + Math.cos(fa) * 10, fy + Math.sin(fa) * 10, now);
        if (o && q) angle = Math.atan2(q.y - o.y, q.x - o.x);
      }

      const hurt = e.hp < prev.hp;
      if (hurt) this.onHit(st, e);
      // a bite is a cooldown being set: the sim's fact, read back as a swing
      // ...and a spit is its windup starting: the mouth opens before the glob leaves
      const attack = e.hitCdUntil > prev.hitCd || (e.spitAt > 0 && e.spitAt !== prev.spitAt);
      prev.hitCd = e.hitCdUntil;
      prev.spitAt = e.spitAt;

      rig.update({
        x: drawX,
        y: drawY,
        angle,
        upright,
        moving: moved > 0.12,
        speed,
        phase: now * (e.type === 'troll' ? 0.006 : 0.014) + e.id * 1.7,
        hpFrac: Math.max(0, e.hp) / e.maxHp,
        alpha: now < e.stunUntil ? 0.6 : 1,
        variant: e.variant,
        dark,
        crouch: e.tempo === 'stalker' && e.tempoState === 1,
        attack,
        hurt,
        lunge: e.tempo === 'stalker' && e.tempoState === 2,
      });
      prev.x = fx;
      prev.y = fy;
      prev.frame = frameKey;
      prev.at = now;
      prev.hp = e.hp;
      prev.angle = fa;
    }

    for (const [id, rig] of this.rigs) {
      if (live.has(id)) continue;
      this.rigs.delete(id);
      this.seen.delete(id);
      // a sheet with a death plays it; otherwise the poof, no gore: a
      // scale-and-fade where it last stood
      if (rig.die()) continue;
      this.scene.tweens.add({
        targets: rig.root,
        scale: rig.root.scale * 2.2,
        alpha: 0,
        duration: 180,
        onComplete: () => rig.destroy(),
      });
    }
  }

  /** the flinch */
  private onHit(_st: Place, e: Enemy) {
    this.rigs.get(e.id)?.setAlpha(0.6);
  }

  /** a run ended: take the whole horde's pictures with it, no poofs */
  clear() {
    this.wards.clear();
    this.charges.clear();
    for (const rig of this.rigs.values()) rig.destroy();
    this.rigs.clear();
    this.seen.clear();
  }
}
