import Phaser from 'phaser';
import type { AcidPool, Loot } from '../combat/types.ts';
import type { Place } from '../sim/place.ts';
import { aboardLocalY } from '../sim/legView.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import * as DEPTH from './depth.ts';

/**
 * Everything that is a circle lying in the world and riding whatever it landed
 * on: dropped coins, mana drops, the stains the dead leave, and the acid a
 * spider spits.
 *
 * They are one view because they are one problem. Each is a position in a
 * FRAME, the ground, or the floor of one particular car, so what the
 * renderer has to do is the same every time: find where the frame is now,
 * put the circle there, and depth it above the car floor when it is inside a
 * car and below the train when it is not. That last rule is the one that had
 * loot invisible-but-collectable aboard a train for a while.
 *
 * As with the projectiles, the simulation holds none of this: it holds a
 * position, a colour and a radius, and the pictures are made to match by id.
 * That is what lets a run's state be cloned for a snapshot (§11c).
 */

interface GroundItem {
  id: number;
  expireAt: number;
  frame: 'world' | 'train';
  ti: number;
  x: number;
  y: number;
  /** aboard, and on the map: x and y are a seat on this journey */
  jid?: string;
  /** on the track bed: below the train that runs over it */
  under?: boolean;
  color: number;
  r: number;
}

export class GroundView {
  private readonly views = new Map<number, Phaser.GameObjects.Arc>();

  /**
   * @param depthWorld how deep it sits on the station floor
   * @param depthTrain and on a car's floor, above the body, which is at 5
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depthWorld: number,
    private readonly depthTrain: number,
    private readonly alpha: number,
    private readonly stroke?: { width: number; color: number; alpha: number },
  ) {}

  sync(st: Place, items: readonly GroundItem[], now = 0, fade?: (item: GroundItem) => number) {
    const live = new Set<number>();
    for (const it of items) {
      live.add(it.id);
      const rail = it.frame === 'train' ? st.rails[it.ti] : undefined;
      if (it.frame === 'train' && !rail) continue;
      // a drop aboard is a SEAT on a journey when there is a map to put it on
      // (combat/types.ts Loot.jid); in the old world it is the car's own x
      const seat = it.jid ? aboardPoint(it.jid, it.x, it.y, now) : null;
      const wx = seat ? seat.x : rail ? rail.train.x + it.x : it.x;
      const ly = seat ? seat.y : rail ? aboardLocalY(st, it.ti, wx, it.y) : it.y;
      let arc = this.views.get(it.id);
      if (!arc) {
        arc = this.scene.add
          .circle(wx, st.worldY(wx, ly), it.r, it.color)
          .setDepth(it.frame === 'train' ? this.depthTrain : this.depthWorld)
          .setAlpha(this.alpha);
        if (this.stroke) arc.setStrokeStyle(this.stroke.width, this.stroke.color, this.stroke.alpha);
        this.views.set(it.id, arc);
      }
      arc.setPosition(wx, st.worldY(wx, ly));
      // a thing that rode into a station on a train is now standing on one;
      // a coin crushed out onto the bed lies UNDER the metal (from play
      // 2026-09-21: coins drawn on top of the train)
      arc.setDepth(it.frame === 'train' ? this.depthTrain : it.under ? DEPTH.PORTAL + 0.02 : this.depthWorld);
      if (fade) arc.setAlpha(fade(it));
    }
    for (const [id, arc] of this.views) {
      if (live.has(id)) continue;
      arc.destroy();
      this.views.delete(id);
    }
  }

  clear() {
    for (const arc of this.views.values()) arc.destroy();
    this.views.clear();
  }
}

/** the four of them, since a scene always wants the same set */
export class GroundViews {
  readonly coins: GroundView;
  readonly pickups: GroundView;
  readonly stains: GroundView;
  readonly pools: GroundView;

  constructor(scene: Phaser.Scene) {
    // LOOT IS AN ACTOR (render/depth.ts rule 3): dropped in a bore at floor
    // depth it sat under the tunnel's dark, and aboard at exactly the cars'
    // own depth it hid under a car whose images were rebuilt after it
    this.coins = new GroundView(scene, DEPTH.ACTOR_MIN + 0.05, DEPTH.ACTOR_MIN + 0.09, 1);
    this.pickups = new GroundView(scene, DEPTH.ACTOR_MIN + 0.06, DEPTH.ACTOR_MIN + 0.09, 1);
    this.stains = new GroundView(scene, 0.8, 5.5, 0.22);
    this.pools = new GroundView(scene, 1.45, 5.6, 0.34, {
      width: 2,
      color: 0x9be04a,
      alpha: 0.5,
    });
  }

  sync(st: Place, now: number) {
    this.coins.sync(st, st.coins as readonly Loot[], now);
    this.pickups.sync(st, st.pickups as readonly Loot[], now);
    this.stains.sync(st, st.stains as readonly Loot[], now);
    // acid thins as it dries, and creeps while it is still wet
    this.pools.sync(st, st.acidPools as readonly AcidPool[], now, (p) =>
      Math.max(0, 0.34 * Math.min(1, (p.expireAt - now) / 1500) + Math.sin(now / 150) * 0.04),
    );
  }

  clear() {
    this.coins.clear();
    this.pickups.clear();
    this.stains.clear();
    this.pools.clear();
  }
}
