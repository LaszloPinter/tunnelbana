import Phaser from 'phaser';
import { sheetFor, type AnimSpec, type SheetSpec } from './spriteSpecs.ts';

/**
 * Enemy visuals. Two modes behind one interface:
 * - CLASSICS (runner/spitter vättar, troll): the beloved sprite art, with
 *   the bob/flip/health-tint behavior it always had.
 * - FAUNA (spider, maggot): the user's reference art sliced into parts and
 *   animated in code, 8 spider legs swaying in trot groups, maggot rings
 *   crawling with a peristaltic wave. Art faces UP, so these containers
 *   rotate to angle + PI/2.
 */
import type { EnemyKind, Variant } from '../combat/types.ts';
export type { EnemyKind };

// spider part anchors measured on the 4x-scaled clean art (516x428):
// ax/ay = attachment point relative to body center (250, 222); ox/oy = the
// origin inside each leg crop that sits AT that attachment
const SPIDER_LEGS: { key: string; ax: number; ay: number; ox: number; oy: number }[] = [
  { key: 'l1', ax: -55, ay: -102, ox: 1, oy: 0.89 },
  { key: 'l2', ax: -75, ay: -32, ox: 1, oy: 0.86 },
  { key: 'l3', ax: -80, ay: 28, ox: 1, oy: 0.6 },
  { key: 'l4', ax: -55, ay: 78, ox: 1, oy: 0.1 },
  { key: 'r1', ax: 65, ay: -102, ox: 0, oy: 0.89 },
  { key: 'r2', ax: 90, ay: -32, ox: 0, oy: 0.86 },
  { key: 'r3', ax: 95, ay: 28, ox: 0, oy: 0.6 },
  { key: 'r4', ax: 70, ay: 78, ox: 0, oy: 0.1 },
];
const SPIDER_SCALE = 0.159;

export interface EnemyPose {
  x: number;
  y: number;
  angle: number;
  /** how far the VIEW is turned. A sprite drawn from above has an up, and the
   * camera turns with the world now (src/world/bearing.ts), so without this
   * a vatte standing on a platform lies on its side whenever the platform
   * happens to run north-south. Only art with an up needs it: a spider is
   * drawn facing its own way and turns with the world quite happily. */
  upright: number;
  moving: boolean;
  /** its own speed, px/s, the run cycle is paced to it */
  speed?: number;
  phase: number;
  hpFrac: number;
  alpha: number;
  /** the build shows as tint; the size came in at construction */
  variant?: Variant;
  /** how far into the chain: 0 the first ride, up to 0.65, the horde goes black */
  dark?: number;
  /** a stalker gathering itself: the beat of stillness before the lunge */
  crouch?: boolean;
  /** it bit (or beat on a ward) this frame: play the attack */
  attack?: boolean;
  /** it was hurt this frame */
  hurt?: boolean;
  /** a stalker mid-lunge: the sheet's charge, if it has one */
  lunge?: boolean;
}

export class EnemyRig {
  readonly root: Phaser.GameObjects.Container;
  private kind: EnemyKind;
  private sprite?: Phaser.GameObjects.Sprite;
  private spriteScale = 1;
  private legsA: Phaser.GameObjects.Image[] = [];
  private legsB: Phaser.GameObjects.Image[] = [];

  private sizeMul: number;

  /** frame-animated from a sheet (spriteSpecs.ts); null = drawn from shapes */
  private sheet: SheetSpec | null = null;
  private scene: Phaser.Scene;
  private dying = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    kind: EnemyKind,
    sizeMul = 1,
    variant: Variant = 'plain',
  ) {
    this.kind = kind;
    this.sizeMul = sizeMul;
    this.scene = scene;
    const parts: Phaser.GameObjects.GameObject[] = [];

    const sheet = sheetFor(kind, variant);
    if (sheet && scene.textures.exists(sheet.anims.idle.key)) {
      // A SHEET: real frames. Idle by default; the state machine is update()
      this.sheet = sheet;
      for (const a of Object.values(sheet.anims))
        if (a) ensureAnim(scene, a, a === sheet.anims.idle || a === sheet.anims.run);
      this.sprite = scene.add.sprite(0, 0, sheet.anims.idle.key).setOrigin(0.5, sheet.anchorY ?? 0.5);
      this.spriteScale = sheet.targetH / sheet.anims.idle.frameH;
      this.sprite.setScale(this.spriteScale);
      this.sprite.play(sheet.anims.idle.key);
      parts.push(this.sprite);
      this.root = scene.add.container(x, y, parts).setDepth(5.8);
      this.root.setScale(sizeMul);
      return;
    }

    if (kind === 'spider') {
      // the user's cleaned art, sliced: 8 legs trotting under the body
      SPIDER_LEGS.forEach((leg, i) => {
        const img = scene.add
          .image(leg.ax * SPIDER_SCALE, leg.ay * SPIDER_SCALE, `fauna-spider-leg-${leg.key}`)
          .setOrigin(leg.ox, leg.oy)
          .setScale(SPIDER_SCALE);
        (i % 2 === 0 ? this.legsA : this.legsB).push(img);
        parts.push(img);
      });
      parts.push(scene.add.image(0, 0, 'fauna-spider-body').setScale(SPIDER_SCALE));
    } else {
      // THE CLASSICS: the original art (Kenney-style), which the user judged
      // the best-looking of everything tried, the shape creatures and the
      // side-view sprite packs are both withdrawn (2026-08-28, from play).
      // BERGAKUNGEN is the troll grown into a hill, crowned with raw rock,
      // and the cacodaemon borrows the troll's bulk until it has art.
      const tex = kind === 'runner' ? 'fauna-runner' : kind === 'spitter' ? 'fauna-spitter' : 'fauna-troll';
      this.sprite = scene.add.sprite(0, 0, tex);
      this.spriteScale =
        (kind === 'troll' || kind === 'boss' ? 50 : kind === 'daemon' ? 62 : 27) /
        Math.max(1, this.sprite.height);
      this.sprite.setScale(this.spriteScale);
      parts.push(this.sprite);
      if (kind === 'boss') {
        // a crown of raw rock circling the brow
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI * 0.8 + (i / 4) * Math.PI * 0.6;
          parts.push(
            scene.add
              .polygon(Math.cos(a) * 20, -26 + Math.sin(a) * 6, [0, -8, 5, 2, -5, 2], 0xd8c06a)
              .setStrokeStyle(2, 0x2b3038)
              .setRotation(a * 0.3),
          );
        }
      }
    }

    this.root = scene.add.container(x, y, parts).setDepth(5.8);
    if (kind !== 'spider') this.root.setScale(sizeMul);
  }

  update(p: EnemyPose) {
    const hpScale = 0.82 + 0.18 * p.hpFrac;
    // ART WITH AN UP STAYS UP. Every rig gets the view's angle here, before
    // any of the branches below; the ones that face their own way add to it.
    // Setting it inside one branch left every other kind of vatte lying at
    // whatever angle the platform happened to run (from play 2026-09-10).
    this.root.setPosition(p.x, p.y).setAlpha(p.alpha);
    // ...but the spider turns from where it WAS, not from the view's angle:
    // overwriting its rotation here and then easing 0.3 rad from that left
    // it pinned within a third of a radian of "up" every frame, so it came
    // at you legs first (from play 2026-09-24: "approaching sideways")
    const turned = this.root.rotation;
    this.root.rotation = p.upright;
    const s = p.moving ? Math.sin(p.phase) : 0;

    if (this.sheet && this.sprite) {
      if (this.dying) return;
      const an = this.sheet.anims;
      // WHICH WAY IT FACES ON SCREEN: the heading is a world angle and the
      // sprite is held level by `upright`, so the screen heading is the
      // difference, judged by the world angle alone, a vätte running
      // screen-right on a north-south platform never flipped at all
      const facing = Math.cos(p.angle - p.upright);
      const flip = this.sheet.facesLeft ? facing > 0 : facing < 0;
      if (Math.abs(facing) > 0.2) this.sprite.setFlipX(flip);
      const cur = this.sprite.anims.currentAnim?.key;
      const busy = this.sprite.anims.isPlaying && (cur === an.attack?.key || cur === an.hurt?.key);
      // one-shots win: an attack, then a flinch; they hand back to the loop
      if (p.attack && an.attack) this.oneShot(an.attack);
      else if (p.hurt && an.hurt && cur !== an.attack?.key) this.oneShot(an.hurt);
      else if (!busy) {
        const want = p.lunge && an.lunge ? an.lunge : p.moving && !p.crouch ? an.run : an.idle;
        if (cur !== want.key) this.sprite.play(want.key, true);
        // the stride keeps pace with the feet: a slowed or prowling one
        // does not sprint on the spot (from play). Clamped so a lunge reads
        // as fast, not as a blur
        // ...and to the SIZE: a bigger body takes longer strides, so the
        // same speed is fewer steps (from play: a brute took four steps to
        // cover one)
        if (want === an.run && this.sheet.runSpeed) {
          const depicted = this.sheet.runSpeed * this.sizeMul;
          this.sprite.anims.timeScale = Math.min(1.8, Math.max(0.3, (p.speed ?? depicted) / depicted));
        } else this.sprite.anims.timeScale = 1;
      }
      // the crouch is the stalker's tell, on any art
      if (p.crouch) this.root.setScale(this.sizeMul * 1.12, this.sizeMul * 0.8);
      else this.root.setScale(this.sizeMul);
      return;
    }

    if (this.kind === 'spider') {
      // the 8 legs trot in alternating groups
      this.root.setScale(hpScale);
      // ...and this one faces where it is GOING, which is a heading in the
      // world: the camera turns it along with the ground it runs on, so the
      // view's own angle must not be added a second time
      this.root.rotation = Phaser.Math.Angle.RotateTo(turned, p.angle + Math.PI / 2, 0.3);
      this.legsA.forEach((leg, i) => (leg.rotation = s * 0.18 * (i % 2 ? 1 : -1)));
      this.legsB.forEach((leg, i) => (leg.rotation = -s * 0.18 * (i % 2 ? 1 : -1)));
    } else if (this.sprite) {
      // the classics keep their old life: bob, flip toward heading, tint,
      // and stay the right way up, whatever bearing the ground runs at
      this.root.rotation = p.upright;
      const bob = p.moving ? Math.sin(p.phase) : Math.sin(p.phase * 0.4) * 0.4;
      this.sprite.y = bob * 0.8;
      const facing = Math.cos(p.angle - p.upright);
      if (Math.abs(facing) > 0.2) this.sprite.setFlipX(facing < 0);
      const grey = Math.round((105 + 150 * p.hpFrac) * (1 - (p.dark ?? 0)));
      if (p.variant === 'brute')
        // a brute is dark and blood-heavy
        this.sprite.setTint(
          Phaser.Display.Color.GetColor(grey, Math.round(grey * 0.62), Math.round(grey * 0.55)),
        );
      else if (p.variant === 'runt')
        // a runt is pale, sickly yellow
        this.sprite.setTint(
          Phaser.Display.Color.GetColor(grey, Math.round(grey * 0.98), Math.round(grey * 0.62)),
        );
      else if (p.variant === 'stone') {
        // THE TUNNEL'S OWN. A stone vätte is the same art gone dark and cold,
        // it has taken the rock in, and it takes three times the killing.
        const d = Math.round(grey * 0.42);
        this.sprite.setTint(Phaser.Display.Color.GetColor(d, d, Math.round(grey * 0.5)));
      } else if (p.variant === 'elite') {
        // AN ELITE is the dark itself, a violet gleam in it, the one in
        // front with the ward (combat/shield.ts)
        const d = Math.round(grey * 0.22);
        this.sprite.setTint(Phaser.Display.Color.GetColor(Math.round(d * 1.3), d, Math.round(grey * 0.42)));
      } else if (p.variant === 'quick') {
        // ...and a quick one burns amber: twice the pace, twice the bite
        this.sprite.setTint(
          Phaser.Display.Color.GetColor(
            Math.min(255, Math.round(grey * 1.15)),
            Math.round(grey * 0.88),
            Math.round(grey * 0.24),
          ),
        );
      } else this.sprite.setTint(Phaser.Display.Color.GetColor(grey, grey, grey));
      const base = this.sizeMul * hpScale;
      // the crouch: squat and widen, so the lunge has a tell you can read
      if (p.crouch) this.root.setScale(base * 1.15, base * 0.78);
      else this.root.setScale(base * (1 + bob * 0.03));
    }
  }

  private oneShot(a: AnimSpec) {
    if (!this.sprite || !this.sheet) return;
    const back = this.sheet.anims.idle.key;
    this.sprite.play(a.key, true);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.sprite && this.sprite.anims.currentAnim?.key === a.key) this.sprite.play(back, true);
    });
  }

  /** it died: the sheet's death if it has one, else the caller's poof. Returns true if handled */
  die(): boolean {
    const d = this.sheet?.anims.death;
    if (!d || !this.sprite) return false;
    this.dying = true;
    this.sprite.play(d.key, true);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      this.scene.tweens.add({
        targets: this.root,
        alpha: 0,
        duration: 250,
        onComplete: () => this.destroy(),
      });
    });
    return true;
  }

  setAlpha(a: number) {
    this.root.setAlpha(a);
  }

  destroy() {
    this.root.destroy();
  }
}

/** define the animation once per scene; a sheet shared by several looks is fine */
function ensureAnim(scene: Phaser.Scene, a: AnimSpec, loop: boolean) {
  if (scene.anims.exists(a.key)) return;
  const start = a.start ?? 0;
  scene.anims.create({
    key: a.key,
    frames: scene.anims.generateFrameNumbers(a.key, { start, end: start + a.frames - 1 }),
    frameRate: a.fps,
    // idle and run loop; attack, hurt and death play once and hand back
    repeat: loop ? -1 : 0,
  });
}
