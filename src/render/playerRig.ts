import Phaser from 'phaser';
import { M } from '../config.ts';
import { BUILD_SCALE, drawBackHair, type PlayerLook } from './look.ts';

/**
 * Procedural top-down player, true GTA2 anatomy: the top of the head sits IN
 * the middle of broad shoulders (no face, you're looking straight down),
 * and the walk cycle is fists and knees pumping FORWARD past the shoulder
 * line, alternating sides. Two bones: LEGS step toward movement, TORSO
 * (shoulders/arms/head) turns toward aim. Local +X = facing.
 */
export { randomLook, type PlayerLook } from './look.ts';

export interface RigPose {
  x: number;
  y: number;
  aimAngle: number;
  moveAngle: number;
  moving: boolean;
  phase: number;
  cast: 'none' | 'once' | 'hold';
  castT: number;
  alpha: number;
  scale: number;
  glowColor: number;
  glowOn: boolean;
}

const OUTLINE = 0x14151c;
const dk = (c: number, n: number) => Phaser.Display.Color.IntegerToColor(c).darken(n).color;

export class PlayerRig {
  readonly root: Phaser.GameObjects.Container;
  private legs: Phaser.GameObjects.Container;
  private torso: Phaser.GameObjects.Container;
  private shadow!: Phaser.GameObjects.Ellipse;
  private thighL!: Phaser.GameObjects.Rectangle;
  private thighR!: Phaser.GameObjects.Rectangle;
  private footL!: Phaser.GameObjects.Ellipse;
  private footR!: Phaser.GameObjects.Ellipse;
  private forearmL!: Phaser.GameObjects.Rectangle;
  private forearmR!: Phaser.GameObjects.Rectangle;
  private fistL!: Phaser.GameObjects.Arc;
  private fistR!: Phaser.GameObjects.Arc;
  private glow!: Phaser.GameObjects.Arc;
  private torsoBody!: Phaser.GameObjects.Ellipse;
  private look: PlayerLook;
  // shoulder anchors (torso-local) the forearms hinge from
  private readonly shoulderY = M(0.36);
  private readonly shoulderX = -M(0.04);

  constructor(scene: Phaser.Scene, x: number, y: number, look: PlayerLook) {
    this.look = look;
    this.shadow = scene.add.ellipse(M(0.06), M(0.12), M(1.2), M(0.98), 0x05060c).setAlpha(0.32);
    this.legs = scene.add.container(0, 0);
    this.torso = scene.add.container(0, 0);
    this.buildLegs(scene);
    this.buildTorso(scene, look);
    this.root = scene.add.container(x, y, [this.shadow, this.legs, this.torso]).setDepth(6);
    this.applyBuild();
  }

  /** the build is the breadth of the shoulders and the stance: the torso
   * and the legs stretched across, never along */
  private applyBuild() {
    const b = BUILD_SCALE[this.look.build];
    this.torso.setScale(1, b);
    this.legs.setScale(1, b);
    this.shadow.setScale(b);
  }

  private buildLegs(scene: Phaser.Scene) {
    this.legs.removeAll(true);
    const c = this.look.trousers;
    // legs live tucked under the torso; walking thrusts them FORWARD in turn
    this.thighL = scene.add.rectangle(-M(0.1), -M(0.2), M(0.52), M(0.25), c).setStrokeStyle(1.5, OUTLINE);
    this.thighR = scene.add.rectangle(-M(0.1), M(0.2), M(0.52), M(0.25), c).setStrokeStyle(1.5, OUTLINE);
    this.footL = scene.add.ellipse(M(0.14), -M(0.2), M(0.28), M(0.22), 0x1e2026).setStrokeStyle(1.5, OUTLINE);
    this.footR = scene.add.ellipse(M(0.14), M(0.2), M(0.28), M(0.22), 0x1e2026).setStrokeStyle(1.5, OUTLINE);
    this.legs.add([this.thighL, this.thighR, this.footL, this.footR]);
  }

  private buildTorso(scene: Phaser.Scene, look: PlayerLook) {
    const t = this.torso;
    t.removeAll(true);
    // hair that lies over the back: drawn over the shoulders, under the head
    const back: Phaser.GameObjects.GameObject[] = [];
    drawBackHair(
      look,
      (x, y, r) => back.push(scene.add.circle(M(x), M(y), M(r), look.hair).setStrokeStyle(2, OUTLINE)),
      (x, y, w, h) =>
        back.push(scene.add.ellipse(M(x), M(y), M(w), M(h), look.hair).setStrokeStyle(2, OUTLINE)),
    );
    // torso mass behind/under the head
    this.torsoBody = scene.add.ellipse(-M(0.14), 0, M(0.7), M(0.86), look.top).setStrokeStyle(2, OUTLINE);
    // broad shoulder masses either side of the head
    const shL = scene.add
      .circle(this.shoulderX, -this.shoulderY, M(0.25), look.top)
      .setStrokeStyle(2, OUTLINE);
    const shR = scene.add
      .circle(this.shoulderX, this.shoulderY, M(0.25), look.top)
      .setStrokeStyle(2, OUTLINE);
    // forearms: stretched between shoulder and fist every frame
    this.forearmL = scene.add.rectangle(0, 0, M(1), M(0.2), dk(look.top, 18)).setStrokeStyle(1.5, OUTLINE);
    this.forearmR = scene.add.rectangle(0, 0, M(1), M(0.2), dk(look.top, 18)).setStrokeStyle(1.5, OUTLINE);
    // fists, the stars of the GTA2 walk
    this.fistL = scene.add.circle(M(0.24), -M(0.36), M(0.14), look.skin).setStrokeStyle(1.5, OUTLINE);
    this.glow = scene.add
      .circle(M(0.24), M(0.36), M(0.26), 0xd9c8ff)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.fistR = scene.add.circle(M(0.24), M(0.36), M(0.14), look.skin).setStrokeStyle(1.5, OUTLINE);
    // the top of the head, sitting in the middle of the shoulders
    const headCol = look.hat === 'none' ? look.hair : look.hatColor;
    const head = scene.add.circle(M(0.06), 0, M(0.28), headCol).setStrokeStyle(2, OUTLINE);
    const extrasBelow: Phaser.GameObjects.GameObject[] = [];
    if (look.hat === 'none' && look.hairStyle === 'buzz')
      extrasBelow.push(scene.add.circle(M(0.06), 0, M(0.2), look.skin));
    const sheen = scene.add.ellipse(M(0.12), -M(0.06), M(0.22), M(0.16), 0xffffff).setAlpha(0.18);
    const extras: Phaser.GameObjects.GameObject[] = [];
    if (look.hat === 'beanie') {
      extras.push(scene.add.circle(-M(0.06), 0, M(0.1), 0xe8e4dc).setStrokeStyle(1.5, OUTLINE));
    } else if (look.hat === 'cap') {
      extras.push(
        scene.add
          .rectangle(M(0.06) + M(0.38), 0, M(0.2), M(0.44), look.hatColor)
          .setStrokeStyle(1.5, OUTLINE),
      );
    }
    if (look.headphones) {
      extras.push(
        scene.add.rectangle(M(0.04), 0, M(0.09), M(0.72), 0x22242a),
        scene.add.circle(M(0.04), -M(0.32), M(0.11), 0x33363e).setStrokeStyle(1.5, OUTLINE),
        scene.add.circle(M(0.04), M(0.32), M(0.11), 0x33363e).setStrokeStyle(1.5, OUTLINE),
      );
    }
    t.add([
      this.forearmL,
      this.forearmR,
      this.torsoBody,
      shL,
      shR,
      ...back,
      this.fistL,
      this.glow,
      this.fistR,
      head,
      ...extrasBelow,
      sheen,
      ...extras,
    ]);
  }

  setLook(scene: Phaser.Scene, look: PlayerLook) {
    this.look = look;
    this.buildLegs(scene);
    this.buildTorso(scene, look);
    this.applyBuild();
  }

  /** stretch a forearm rect between the shoulder anchor and the fist */
  private layArm(arm: Phaser.GameObjects.Rectangle, sy: number, fx: number, fy: number) {
    // fixed geometry stretched by scaleX, mutating Shape sizes per-frame is
    // unreliable and was leaving stale unrotated rects poking out of the body
    const sx = this.shoulderX;
    const len = Math.hypot(fx - sx, fy - sy);
    arm.setPosition((sx + fx) / 2, (sy + fy) / 2);
    arm.setScale(Math.max(0.001, len / M(1)), 1);
    arm.rotation = Math.atan2(fy - sy, fx - sx);
    arm.setVisible(len > M(0.3));
  }

  update(p: RigPose) {
    this.root.setPosition(p.x, p.y).setAlpha(p.alpha).setScale(p.scale);
    const legTarget = p.moving ? p.moveAngle : p.aimAngle;
    this.legs.rotation = Phaser.Math.Angle.RotateTo(this.legs.rotation, legTarget, 0.28);
    this.torso.rotation = Phaser.Math.Angle.RotateTo(this.torso.rotation, p.aimAngle, 0.35);

    // GTA2 walk: each leg thrusts FORWARD in turn (tucked when standing)
    const sL = p.moving ? Math.max(0, Math.sin(p.phase)) : 0;
    const sR = p.moving ? Math.max(0, -Math.sin(p.phase)) : 0;
    this.thighL.x = Phaser.Math.Linear(this.thighL.x, -M(0.1) + sL * M(0.42), 0.5);
    this.footL.x = Phaser.Math.Linear(this.footL.x, M(0.14) + sL * M(0.5), 0.5);
    this.thighR.x = Phaser.Math.Linear(this.thighR.x, -M(0.1) + sR * M(0.42), 0.5);
    this.footR.x = Phaser.Math.Linear(this.footR.x, M(0.14) + sR * M(0.5), 0.5);

    // fists pump forward opposite the stepping leg
    const punchL = p.moving ? Math.max(0, -Math.sin(p.phase)) : 0;
    const fistLX = M(0.24) + punchL * M(0.42) - (p.moving ? Math.max(0, Math.sin(p.phase)) * M(0.14) : 0);
    const fistLY = -M(0.36) - punchL * M(0.02);
    this.fistL.x = Phaser.Math.Linear(this.fistL.x, fistLX, 0.5);
    this.fistL.y = Phaser.Math.Linear(this.fistL.y, fistLY, 0.5);
    this.layArm(this.forearmL, -this.shoulderY, this.fistL.x, this.fistL.y);

    const punchR = p.moving ? Math.max(0, Math.sin(p.phase)) : 0;
    let fistRX = M(0.24) + punchR * M(0.42) - (p.moving ? Math.max(0, -Math.sin(p.phase)) * M(0.14) : 0);
    let fistRY = M(0.36) + punchR * M(0.02);
    let glowA = p.glowOn ? 0.22 : 0;
    if (p.cast === 'hold') {
      fistRX = M(0.72);
      fistRY = M(0.18);
      glowA = 0.8;
    } else if (p.cast === 'once') {
      const k = Math.sin(Math.min(1, p.castT / 250) * Math.PI);
      fistRX = M(0.24) + k * M(0.52);
      fistRY = M(0.36) - k * M(0.24);
      glowA = 0.22 + k * 0.6;
    }
    this.fistR.x = Phaser.Math.Linear(this.fistR.x, fistRX, 0.55);
    this.fistR.y = Phaser.Math.Linear(this.fistR.y, fistRY, 0.55);
    this.layArm(this.forearmR, this.shoulderY, this.fistR.x, this.fistR.y);
    this.glow.x = this.fistR.x;
    this.glow.y = this.fistR.y;
    this.glow.setAlpha(glowA);

    this.torsoBody.setScale(!p.moving && p.cast === 'none' ? 1 + Math.sin(p.phase * 0.35) * 0.025 : 1);
  }

  setGlowColor(color: number) {
    this.glow.setFillStyle(color);
  }

  destroy() {
    this.root.destroy();
  }
}
