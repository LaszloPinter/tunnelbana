import Phaser from 'phaser';
import * as C from '../config.ts';
import type { PlatformPath } from '../core/platformPath.ts';

/**
 * The joint pattern of a paved surface: how far apart the courses run across
 * it, how many lines run along it, and how heavy and dark those lines are.
 * A deck and a wall are the same problem seen from different sides, so they
 * are the same three numbers.
 */
export interface Surface {
  course: number;
  lanes: number;
  jw: number;
  ink: number;
}

/** cast slabs on an open-air platform, big and few */
export const SLAB: Surface = { course: C.M(7.5), lanes: 2, jw: 2.5, ink: 0.16 };
/** the glazed tile of a cut-and-cover hall */
export const TILE: Surface = { course: C.M(4), lanes: 3, jw: 1.5, ink: 0.16 };

/**
 * BANDS SWEPT ALONG THE CENTRELINE. On a straight station a band is exactly
 * the rectangle it used to be; on a curved one it bends with the platform.
 *
 * Two things keep this cheap, both learned the hard way. Phaser's Graphics
 * is immediate mode, it re-runs its command buffer and re-triangulates
 * every fill EVERY frame, so (1) only the stretch that actually bends
 * becomes a polygon, the flat remainder staying a Rectangle, which is one
 * quad and no tessellation; and (2) every bend in the station goes into ONE
 * Graphics per depth rather than one apiece, because at a six-rail
 * interchange that is 27 draw calls a frame against one, but not ONE for
 * the whole station, or the wall would paint over the ads hanging on it.
 */
const SWEEP_STEP = C.M(8);

/**
 * Drop the samples that sit on the line between their neighbours. Graphics
 * is immediate mode and re-triangulates its whole buffer every frame, so a
 * point that adds no shape costs time sixty times a second, and a station
 * bends gently, so most of them add nothing (2026-09-05).
 */
function simplify(pts: Phaser.Math.Vector2[]): Phaser.Math.Vector2[] {
  if (pts.length < 3) return pts;
  const out: Phaser.Math.Vector2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    if (Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len > 0.35) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

interface Bend {
  top: number;
  bottom: number;
  color: number;
  alpha: number;
  xa: number;
  xb: number;
  surface?: Surface;
  depth: number;
}

export class Sweeper {
  readonly decor: Phaser.GameObjects.GameObject[] = [];
  private readonly bends: Bend[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly path: PlatformPath,
  ) {}

  /** a band from xa to xb between top and bottom; `surface` paves it */
  sweep(
    xa: number,
    xb: number,
    top: number,
    bottom: number,
    color: number,
    depth: number,
    alpha = 1,
    surface?: Surface,
  ) {
    const flatPart = (x0: number, x1: number) => {
      if (x1 - x0 < 0.5) return;
      this.decor.push(
        this.scene.add
          .rectangle((x0 + x1) / 2, (top + bottom) / 2, x1 - x0, bottom - top, color)
          .setDepth(depth)
          .setAlpha(alpha),
      );
    };
    const b0 = Math.max(xa, this.path.bendFrom);
    const b1 = Math.min(xb, this.path.bendTo);
    if ((this.path.flat || b1 <= b0) && surface === undefined) {
      flatPart(xa, xb);
      return;
    }
    if (surface === undefined) {
      flatPart(xa, b0);
      flatPart(b1, xb);
    }
    this.bends.push({ top, bottom, color, alpha, xa, xb, surface, depth });
  }

  /** everything the curve bends, drawn last so a band can be requested from
   * anywhere, the walls are built long after the decks are */
  flush() {
    const byDepth = new Map<number, Bend[]>();
    for (const b of this.bends) {
      const at = byDepth.get(b.depth);
      if (at) at.push(b);
      else byDepth.set(b.depth, [b]);
    }
    for (const [depth, group] of byDepth) {
      const g = this.scene.add.graphics().setDepth(depth);
      for (const b of group) this.drawBend(g, b);
      this.decor.push(g);
    }
    this.bends.length = 0;
  }

  private drawBend(g: Phaser.GameObjects.Graphics, b: Bend) {
    const path = this.path;
    // a band carrying a paved surface has to be swept its whole length,
    // not only where the centreline bends; any other band only where its
    // OWN span overlaps the bend (whatever falls outside is already drawn
    // as plain rectangles by sweep)
    const whole = b.surface !== undefined;
    const from = whole ? b.xa : Math.max(b.xa, path.bendFrom);
    const to = whole ? b.xb : Math.min(b.xb, path.bendTo);
    // a band is a plain rectangle on a straight station, joints and all,
    // 58 of the 100 pay nothing here
    const straight = path.flat;
    const at = (x: number, y: number) => y + path.offsetAt(x);
    const samples = (step: number) => {
      const xs: number[] = [];
      for (let x = from; x < to; x += step) xs.push(x);
      xs.push(to);
      return xs;
    };
    const band = (top: number, bottom: number, step: number) => {
      const xs = samples(step);
      const pts: Phaser.Math.Vector2[] = [];
      for (const x of xs) pts.push(new Phaser.Math.Vector2(x, at(x, top)));
      for (let i = xs.length - 1; i >= 0; i--) pts.push(new Phaser.Math.Vector2(xs[i], at(xs[i], bottom)));
      g.fillPoints(simplify(pts), true);
    };
    g.fillStyle(b.color, b.alpha);
    if (straight) g.fillRect(from, b.top, to - from, b.bottom - b.top);
    else band(b.top, b.bottom, SWEEP_STEP);
    if (b.surface) {
      const s = b.surface;
      g.fillStyle(0x000000, s.ink);
      // courses run across the band, so they stay upright whatever the
      // centreline is doing, only where they START follows it
      for (let x = from + s.course; x < to; x += s.course)
        g.fillRect(x, at(x, b.top) + 2, s.jw, b.bottom - b.top - 4);
      for (let l = 1; l <= s.lanes; l++) {
        const y = b.top + ((b.bottom - b.top) * l) / (s.lanes + 1);
        if (straight) g.fillRect(from, y, to - from, s.jw);
        else band(y, y + s.jw, SWEEP_STEP * 4);
      }
    }
  }
}
