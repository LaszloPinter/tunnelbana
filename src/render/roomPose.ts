import Phaser from 'phaser';
import { ANCHOR_X, ANCHOR_Y } from '../core/worldNet.ts';

/**
 * WHERE A ROOM STANDS ON THE MAP, AND WHICH WAY UP IT IS SHOWN.
 *
 * A room is posed about its ANCHOR, the point its plan is written around,
 * so turning it half round is the same room seen from its other end: the far
 * platform on the left instead of the right, every bench, machine and sign
 * standing up, every word readable. ONE rotation, so nothing can be left
 * behind.
 *
 * Turning each PIECE separately is what broke twice: a bench is an object
 * with a middle and comes round neatly; a Graphics is a whole swathe of the
 * room drawn in the room's coordinates and is flung across the station; a
 * kiosk made of both ends up half-turned. (From play: "the platform is pitch
 * black", then "vendor assets upside down".)
 *
 * Why it has to turn at all: the camera follows the track, and a line may be
 * written either way round, so the view settles on whichever half-turn it is
 * already nearer (world/bearing.ts). Half the time that is the station's own
 * bearing through 180°.
 */
export class RoomPose {
  private anchorX = 0;
  private anchorY = 0;
  private angle = 0;
  private flipped = false;

  at(anchorX: number, anchorY: number, angle: number) {
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.angle = angle;
  }

  /** shown from its other end: what is READ turns in place (placeView.ts) */
  get isFlipped(): boolean {
    return this.flipped;
  }

  apply(box: Phaser.GameObjects.Container) {
    // THE ROOM NEVER TURNS HALF ROUND. It used to: shown "from its other
    // end" was one rotation of the whole box by π about the anchor, which
    // reads well and is WRONG, it is a point reflection of the plan through
    // the platform's midpoint, so every asymmetric fixture was drawn where
    // its mirror image stands: the mana machine on the health machine's
    // spot and the health machine on the mana's, with E answering to the
    // real ones (from play 2026-09-24: "the health vending machine is not
    // where it seems to be"). The room stands at its true pose; only what
    // is read turns in place (faceUp).
    const a = this.angle;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    box
      .setPosition(
        this.anchorX - (cos * ANCHOR_X - sin * ANCHOR_Y),
        this.anchorY - (sin * ANCHOR_X + cos * ANCHOR_Y),
      )
      .setRotation(a);
  }

  /** `upright` is the world rotation that comes out level on screen. True
   * when the answer changed: the caller turns the room's words (placeView.ts) */
  faceUp(upright: number): boolean {
    let a = (this.angle - upright) % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    const flip = Math.abs(a) > Math.PI / 2;
    if (flip === this.flipped) return false;
    this.flipped = flip;
    return true;
  }
}
