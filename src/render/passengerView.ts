import type Phaser from 'phaser';
import * as C from '../config.ts';
import { makeRng } from '../sim/det.ts';
import type { Passenger } from '../sim/passenger.ts';
import type { Run } from '../sim/run.ts';
import { lookFrom, type PlayerLook } from './look.ts';
import { PlayerRig } from './playerRig.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { UI_FONT } from '../scenes/hudStatus.ts';
import type { camRect } from './camRect.ts';

/**
 * THE PASSENGERS, DRAWN (DESIGN §20): the commuter rig every player walks
 * around as, dressed from the passenger's own seed so every client sees the
 * same stranger, and for a kind with a uniform, in it. A small bar over
 * the head once they are hurt. Nothing here touches the sim.
 */
interface Piece {
  rig: PlayerRig;
  bar: Phaser.GameObjects.Graphics;
  /** what they last said, over their head for a few seconds (combat/paxTalk.ts) */
  bubble: Phaser.GameObjects.Text;
  phase: number;
  lastX: number;
  lastY: number;
  /** aboard: where in the car they were last frame */
  lastRx: number;
  lastRy: number;
  face: number;
  lastDrawAt: number;
}

/** dressed for what they are: the guard in uniform, the nurse in scrubs, the teenager in a hoodie */
function dressed(ps: Passenger): PlayerLook {
  const look = lookFrom(makeRng(ps.lookSeed));
  if (ps.kind === 'vaktare')
    return { ...look, top: 0x1e2a44, trousers: 0x1a1c22, hat: 'cap', hatColor: 0x161c2c, headphones: false };
  if (ps.kind === 'sjukskoterska')
    return { ...look, top: 0x9fd4e8, trousers: 0x9fd4e8, hat: 'none', headphones: false };
  if (ps.kind === 'langare')
    return {
      ...look,
      top: 0x16171c,
      trousers: 0x1e1e24,
      hat: 'beanie',
      hatColor: 0x16171c,
      headphones: false,
      hairStyle: 'short',
    };
  if (ps.kind === 'tonaring')
    return { ...look, top: 0xe0508e, hat: 'beanie', hatColor: 0x2a2c34, headphones: true };
  return look;
}

/** how long a line stays over a head */
const SAY_MS = 3200;

export class PassengerView {
  private readonly pieces = new Map<number, Piece>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** `upright`: the turn that reads level on screen (scenes/worldChart.ts) */
  draw(run: Run, now: number, box: ReturnType<typeof camRect>, upright: number) {
    const seen = new Set<number>();
    for (const ps of run.pax) {
      if (!ps.alive || !run.live.has(ps.placeId)) continue;
      const pad = C.M(3);
      if (ps.x < box.x0 - pad || ps.x > box.x1 + pad || ps.y < box.y0 - pad || ps.y > box.y1 + pad) continue;
      seen.add(ps.id);
      let pc = this.pieces.get(ps.id);
      if (!pc) {
        pc = {
          rig: new PlayerRig(this.scene, ps.x, ps.y, dressed(ps)),
          bar: this.scene.add.graphics().setDepth(6.6),
          bubble: this.scene.add
            .text(0, 0, '', {
              fontFamily: UI_FONT,
              fontSize: '13px',
              fontStyle: 'bold',
              color: '#edf1f7',
              backgroundColor: '#0b0e14b0',
              padding: { x: 7, y: 4 },
              align: 'center',
              wordWrap: { width: 190 },
            })
            .setOrigin(0.5, 1)
            .setDepth(6.7)
            .setVisible(false),
          phase: 0,
          lastX: ps.x,
          lastY: ps.y,
          lastRx: 0,
          lastRy: 0,
          face: 0,
          lastDrawAt: now,
        };
        // just under the players, in the actors' band (render/depth.ts)
        pc.rig.root.setDepth(5.98);
        this.pieces.set(ps.id, pc);
      }
      // WALKING is moving about IN the car, aboard, the train carrying a
      // seated rider along is not them walking (from play 2026-10-11)
      let moving: boolean;
      const f = ps.frame;
      if (f.kind === 'aboard' && f.jid) {
        const drx = f.rx - pc.lastRx;
        const dry = f.ry - pc.lastRy;
        moving = Math.hypot(drx, dry) > 0.2;
        if (moving) {
          const a = aboardPoint(f.jid, f.rx - drx, f.ry - dry, run.gameNow);
          const b = aboardPoint(f.jid, f.rx, f.ry, run.gameNow);
          if (a && b) pc.face = Math.atan2(b.y - a.y, b.x - a.x);
        }
        pc.lastRx = f.rx;
        pc.lastRy = f.ry;
      } else {
        const dx = ps.x - pc.lastX;
        const dy = ps.y - pc.lastY;
        moving = Math.hypot(dx, dy) > 0.2;
        if (moving) pc.face = Math.atan2(dy, dx);
      }
      const dt = Math.min(now - pc.lastDrawAt, 100);
      pc.phase += dt * (moving ? 0.011 : 0.004);
      pc.lastX = ps.x;
      pc.lastY = ps.y;
      pc.lastDrawAt = now;
      const castT = now - ps.swingAt;
      pc.rig.root.setVisible(true);
      pc.rig.update({
        x: ps.x,
        y: ps.y,
        aimAngle: pc.face,
        moveAngle: pc.face,
        moving,
        phase: pc.phase,
        cast: castT >= 0 && castT < 250 ? 'once' : 'none',
        castT,
        alpha: 1,
        scale: 1,
        glowColor: 0,
        glowOn: false,
      });
      // the bar reads level on SCREEN, over the head, whatever the view's turn
      const g = pc.bar.clear().setPosition(ps.x, ps.y).setRotation(upright);
      if (ps.hp < ps.maxHp) {
        const w = C.M(1.2);
        const bx = -w / 2;
        const by = -C.M(1.1);
        g.fillStyle(0x0e1116, 0.85).fillRect(bx - 1, by - 1, w + 2, 5);
        g.fillStyle(0x8ef0a8, 1).fillRect(bx, by, w * Math.max(0, ps.hp / ps.maxHp), 3);
      }
      g.setVisible(true);
      // THE BUBBLE: level on screen, over the head, fading in its last half second
      const age = now - ps.sayAt;
      const b = pc.bubble;
      if (ps.say && age >= 0 && age < SAY_MS) {
        if (b.text !== ps.say) b.setText(ps.say);
        const h = C.M(1.35);
        b.setPosition(ps.x + h * Math.sin(upright), ps.y - h * Math.cos(upright))
          .setRotation(upright)
          .setAlpha(Math.min(1, (SAY_MS - age) / 500))
          .setVisible(true);
      } else b.setVisible(false);
    }
    for (const [id, pc] of this.pieces) {
      if (seen.has(id)) continue;
      // gone for good, or only out of sight: hide the out-of-sight, drop the gone
      if (run.pax.some((q) => q.id === id)) {
        pc.rig.root.setVisible(false);
        pc.bar.setVisible(false);
        pc.bubble.setVisible(false);
        continue;
      }
      pc.rig.destroy();
      pc.bar.destroy();
      pc.bubble.destroy();
      this.pieces.delete(id);
    }
  }
}
