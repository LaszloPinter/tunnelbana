import Phaser from 'phaser';
import * as C from '../config.ts';
import { LANE_INFO } from '../core/lanes.ts';
import { airborne, aimWorld, type Player } from '../sim/player.ts';
import { PlayerRig } from './playerRig.ts';
import type { PlayerLook } from './look.ts';

/** what a player's picture needs from the scene */
export interface PlayerViewHost {
  add: Phaser.GameObjects.GameObjectFactory;
  /** where a player is drawn in the current view (a corridor walker's
   * position is their leg unrolled into the station frame) */
  viewOf(p: Player): { x: number; y: number };
  /** where a seat is drawn ON SCREEN, its place's point through the chart */
  drawnAt(p: Player): { x: number; y: number };
  worldY(x: number, y: number): number;
  drawAngle(x: number, dx: number, dy: number): number;
}

interface Piece {
  rig: PlayerRig;
  /** YOU ARE HERE: a soft ring under the local seat only, the figure is
   * small among the horde, and new players lost it (alpha UX pass) */
  ring: Phaser.GameObjects.Ellipse | null;
  aura: Phaser.GameObjects.Arc;
  /** the aura LANE's six-metre ring, colour-coded by mode */
  /** the stride is a picture thing: it runs on frame time, not sim time */
  stridePhase: number;
  lastDrawAt: number;
  /** the element the casting hand is lit with, so it is set once */
  glow: string | null;
}

/**
 * One rig per commuter, kept by seat like every other view keeps its map
 * from id to picture. The simulation says where each player is and what
 * they are doing; this makes the picture match, for all of them, the local
 * player is only special to the camera and the HUD, not here.
 */
export class PlayerView {
  private pieces = new Map<number, Piece>();

  constructor(
    private host: PlayerViewHost,
    /** who each seat looks like: yours from your prefs, the rest rolled */
    private readonly lookOf: (id: number) => PlayerLook,
    private readonly isLocal: (id: number) => boolean = () => false,
  ) {}

  /** the rig of one seat, the camera follows the local one */
  rigOf(id: number): PlayerRig | undefined {
    return this.pieces.get(id)?.rig;
  }

  /** a new run, or a new look chosen: every seat dressed as it should be */
  reroll(scene: Phaser.Scene) {
    for (const [id, piece] of this.pieces) piece.rig.setLook(scene, this.lookOf(id));
  }

  /** put a seat's rig exactly where the sim says, now, for the camera, which
   * otherwise lerps after a stale target for a frame across a rebuild */
  place(p: Player) {
    const piece = this.ensure(p);
    const at = this.host.drawnAt(p);
    piece.rig.root.setPosition(at.x, at.y);
  }

  private ensure(p: Player): Piece {
    let piece = this.pieces.get(p.id);
    if (!piece) {
      const aura = this.host.add
        .circle(p.x, p.y, p.r + 8, 0xffffff)
        .setDepth(5.95)
        .setAlpha(0)
        .setBlendMode(Phaser.BlendModes.ADD);
      const rig = new PlayerRig(this.host as unknown as Phaser.Scene, p.x, p.y, this.lookOf(p.id));
      const ring = this.isLocal(p.id)
        ? this.host.add
            .ellipse(p.x, p.y, C.M(1.9), C.M(1.9))
            .setStrokeStyle(2, 0xffd23f, 0.55)
            .setFillStyle(0xffd23f, 0.08)
            .setDepth(5.9)
        : null;
      piece = { rig, aura, ring, stridePhase: 0, lastDrawAt: 0, glow: null };
      this.pieces.set(p.id, piece);
    }
    return piece;
  }

  sync(players: Player[], now: number) {
    for (const p of players) {
      const piece = this.ensure(p);
      const { rig, aura } = piece;
      const visible = p.alive;
      rig.root.setVisible(visible);
      piece.ring?.setVisible(visible && !p.downed && p.frame.kind === 'world');
      if (!visible) {
        aura.setAlpha(0);
        continue;
      }
      // on the floor: flat on their back where they fell, dimmed, a faint
      // pulse so a teammate scanning the platform finds them
      const v = this.host.viewOf(p);
      const at = this.host.drawnAt(p);
      if (p.downed) {
        rig.root
          .setPosition(at.x, at.y)
          .setRotation(Math.PI / 2)
          .setAlpha(0.45 + Math.sin(now / 300) * 0.15);
        aura.setAlpha(0);
        continue;
      }
      if (rig.root.rotation !== 0) rig.root.setRotation(0);
      const air = airborne(p, now);
      let scale = 1;
      if (air) {
        const jt = (now - p.jumpStart) / C.DASH_MS;
        scale = jt < 1 ? 1 + Math.sin(Math.PI * Math.min(1, jt)) * (C.JUMP_SCALE - 1) : 1.1;
      }
      // bone rig: legs face movement, torso faces aim, cast pose per weapon.
      // The pose is DERIVED from the cast's timestamps rather than written
      // back: the view must not touch simulation state, or the snapshot of
      // one client differs from another's by what its frame rate saw.
      const cast =
        p.castKind === 'hold'
          ? now > p.castHoldUntil
            ? 'none'
            : 'hold'
          : p.castKind === 'once'
            ? now - p.castStart > 250
              ? 'none'
              : 'once'
            : 'none';
      const dtDraw = Math.min(now - piece.lastDrawAt, 100);
      piece.stridePhase += dtDraw * (p.movingInput ? 0.013 : 0.004);
      piece.lastDrawAt = now;
      const drawY = at.y;
      const aim = aimWorld(p, (x, y) => this.host.worldY(x, y));
      const prim = p.laneOrder[0];
      // your first lane lights up your casting hand, read off the player, so
      // a pick made by any seat, on any client, lights the same hand
      // ...and the ram lane's hand goes white the cast before a RAM
      const heavyNext = p.mods.ramEvery > 0 && (p.castCount + 1) % p.mods.ramEvery === 0;
      const glowKey = prim ? (heavyNext ? `${prim}!` : prim) : undefined;
      if (prim && glowKey && piece.glow !== glowKey) {
        piece.glow = glowKey;
        rig.setGlowColor(heavyNext ? 0xffffff : LANE_INFO[prim].color);
      }
      piece.ring?.setPosition(at.x, drawY);
      rig.update({
        x: at.x,
        y: drawY,
        // the aim and the stride are DIRECTIONS in the place's frame; the
        // chart may be facing the other way, and drawAngle turns them with it
        aimAngle: this.host.drawAngle(v.x, aim.x, aim.y),
        moveAngle: p.movingInput ? this.host.drawAngle(v.x, p.moveDirX || 0.0001, p.moveDirY) : 0,
        moving: p.movingInput,
        phase: piece.stridePhase,
        cast,
        castT: now - p.castStart,
        alpha: now < p.iframesUntil ? 0.55 : 1,
        scale,
        glowColor: 0,
        glowOn: prim !== undefined,
      });
      // lane aura: your first lane glows around you
      if (prim) {
        aura
          .setPosition(at.x, drawY)
          .setFillStyle(LANE_INFO[prim].color)
          .setAlpha(0.16 + Math.sin(now / 260) * 0.05)
          .setScale(scale);
      } else {
        aura.setAlpha(0);
      }
    }
  }
}
