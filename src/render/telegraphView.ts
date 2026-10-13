import Phaser from 'phaser';
import * as C from '../config.ts';
import type { Place } from '../sim/place.ts';
import { aboardPoint, seatHeading } from '../world/trainSeat.ts';

/**
 * The two things the game warns you about before they happen: a tunnel light
 * about to sweep a car, and something about to come in through a window.
 *
 * Both are entities with a moment they land at, so the simulation holds the
 * WHEN and the WHERE and this holds the mounting dread, the amber flooding
 * in, the border hardening, the claw scrabbling at the glass. All of that is
 * derived from `at - now`, so there is nothing to remember between frames and
 * nothing the simulation needs to be told.
 */
export class TelegraphView {
  private readonly strikes = new Map<
    number,
    {
      zone: Phaser.GameObjects.Rectangle;
      border: Phaser.GameObjects.Rectangle;
      warn: Phaser.GameObjects.Text;
    }
  >();
  private readonly boardings = new Map<
    number,
    { frame: Phaser.GameObjects.Rectangle; claw: Phaser.GameObjects.Rectangle }
  >();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(st: Place, now: number) {
    this.syncStrikes(st, now);
    this.syncBoardings(st, now);
  }

  /**
   * WHERE ON THE TRAIN THE WARNING IS, said on the map.
   *
   * Both of these are things about to happen to a PLACE IN A CAR, a stretch
   * of aisle a light will sweep, a window something is about to come through,
   * and the simulation says so in the car's own terms: so far along it, so
   * far across. On the map the car is laid along its line, so a warning is
   * placed exactly as a rider is (world/trainSeat.ts), and it has to be
   * TURNED with the car too, or a zone drawn square across a tunnel that
   * bends covers the wrong piece of aisle. Null while the warning's own
   * train is not standing in that slot.
   */
  private onCar(st: Place, ti: number, rx: number, ry: number, now: number, want?: string) {
    // the warning's OWN train, not whatever is standing in that slot now
    const jid = want ?? st.rails[ti]?.journey;
    if (!jid || (want && st.rails[ti]?.journey !== want)) return null;
    const at = aboardPoint(jid, rx, ry, now);
    const head = seatHeading(jid, rx, now);
    if (!at || !head) return null;
    return { x: at.x, y: at.y, rot: Math.atan2(head.ty, head.tx) };
  }

  private syncStrikes(st: Place, now: number) {
    const live = new Set<number>();
    for (const s of st.strikes) {
      const rail = st.rails[s.ti];
      if (!rail) continue;
      live.add(s.id);
      const w = s.x1 - s.x0;
      const lx = rail.train.x + (s.x0 + s.x1) / 2;
      const on = this.onCar(st, s.ti, (s.x0 + s.x1) / 2, 0, now, s.jid);
      const cx = on ? on.x : lx;
      const cy = on ? on.y : st.worldY(lx, rail.train.centerY);
      const rot = on ? on.rot : 0;
      let v = this.strikes.get(s.id);
      if (!v) {
        v = {
          zone: this.scene.add
            .rectangle(cx, cy, w, C.CAR_WIDTH - 6, 0xffb830)
            .setDepth(6.5)
            .setAlpha(0.15)
            .setBlendMode(Phaser.BlendModes.ADD),
          border: this.scene.add
            .rectangle(cx, cy, w, C.CAR_WIDTH - 6, 0x000000, 0)
            .setDepth(6.55)
            .setStrokeStyle(2, 0xff5a3c, 0.8),
          warn: this.scene.add
            .text(cx, cy, '⚠', { fontFamily: 'monospace', fontSize: '18px', color: '#ffd9a0' })
            .setOrigin(0.5)
            .setDepth(6.56),
        };
        this.strikes.set(s.id, v);
      }
      // danger builds: amber floods in, the border hardens, the mark throbs
      const p = 1 - (s.at - now) / 1600;
      const throb = Math.sin(now / 70) * 0.1;
      v.zone
        .setPosition(cx, cy)
        .setRotation(rot)
        .setAlpha(0.15 + p * 0.45 + throb);
      v.border
        .setPosition(cx, cy)
        .setRotation(rot)
        .setAlpha(0.5 + p * 0.5);
      v.warn
        .setPosition(cx, cy)
        .setScale(1 + p * 0.6 + throb)
        .setAlpha(0.7 + throb * 2);
    }
    for (const [id, v] of this.strikes) {
      if (live.has(id)) continue;
      v.zone.destroy();
      v.border.destroy();
      v.warn.destroy();
      this.strikes.delete(id);
    }
  }

  private syncBoardings(st: Place, now: number) {
    const live = new Set<number>();
    for (const b of st.boardings) {
      const rail = st.rails[b.ti];
      if (!rail) continue;
      live.add(b.id);
      const lx = rail.train.x + b.rx;
      const on = this.onCar(st, b.ti, b.rx, b.ry, now, b.jid);
      const cx = on ? on.x : lx;
      const cy = on ? on.y : st.worldY(lx, rail.train.centerY + b.ry);
      const rot = on ? on.rot : 0;
      let v = this.boardings.get(b.id);
      if (!v) {
        v = {
          frame: this.scene.add
            .rectangle(cx, cy, C.M(1.7), C.M(0.8), 0x1a0b06)
            .setDepth(6.4)
            .setStrokeStyle(2.5, 0xff7a3c, 1),
          claw: this.scene.add.rectangle(cx, cy, C.M(1.2), C.M(0.22), 0xffb060).setDepth(6.45).setAlpha(0.9),
        };
        this.boardings.set(b.id, v);
      }
      const p = 1 - (b.at - now) / 1100;
      const scrabble = Math.sin(now / 45) * 0.5;
      v.frame
        .setPosition(cx, cy)
        .setRotation(rot)
        .setAlpha(0.25 + p * 0.6);
      v.claw
        .setPosition(cx, cy)
        .setRotation(rot + scrabble * 0.5)
        .setAlpha(0.4 + p * 0.6)
        .setScale(0.6 + p * 0.8, 1);
    }
    for (const [id, v] of this.boardings) {
      if (live.has(id)) continue;
      v.frame.destroy();
      v.claw.destroy();
      this.boardings.delete(id);
    }
  }

  clear() {
    for (const v of this.strikes.values()) {
      v.zone.destroy();
      v.border.destroy();
      v.warn.destroy();
    }
    this.strikes.clear();
    for (const v of this.boardings.values()) {
      v.frame.destroy();
      v.claw.destroy();
    }
    this.boardings.clear();
  }
}
