import Phaser from 'phaser';
import * as C from '../config.ts';
import { asLeg, asStation } from '../sim/place.ts';
import { Station } from '../sim/station.ts';
import { fromLeg } from '../world/floor.ts';
import { boreTracks } from '../sim/boreTracks.ts';
import type { Patch } from '../world/bake.ts';
import type { Run } from '../sim/run.ts';
import type { Box } from './mapMetal.ts';

/**
 * THE TUNNEL'S OWN GROUND: its rock, its floor, its rails, and the seam where
 * it meets a station.
 *
 * Split out of render/mapView.ts, which draws the rooms. A bore is hundreds
 * of metres of quads at three-metre steps and there are eight of them live,
 * which is most of what the floor's Graphics holds, and it is immediate
 * mode, so how much of it is emitted is not an aesthetic question. Keeping it
 * here makes that budget visible instead of buried among the platforms.
 */

const BORE = 0x14141a;
const DECK = 0x3a3a44;
/** the rock a bore is cut through, the tunnel's own (render/tunnelArt.ts) */
const ROCK = 0x07070a;
/** how far a station's light reaches up its own tunnel (tunnelGloom.ts) */
const MOUTH_LIGHT = C.M(100);
/** the same rail the station lays (render/stationBuilder.ts SLEEPER) */
const RAIL = 0x4a4a55;
/** how far past the camera the picture reaches: over the 15 m it may go stale by */
const VIEW_PAD = C.M(40);

export class MapBore {
  private cam: Box | null = null;

  /** the rock and the floor, along every bore the camera can see */
  floor(g: Phaser.GameObjects.Graphics, run: Run, cam: Box | null) {
    this.cam = cam;
    for (const id of run.live) {
      /**
       * ONLY THE BORES ON CAMERA, and redrawn the moment the camera has
       * moved fifteen metres, or the floor under it has changed at all.
       *
       * A bore is hundreds of metres of quads at three-metre steps, and this
       * is immediate-mode Graphics: drawing every live leg put tens of
       * thousands of commands into one object, and the picture stopped part
       * way along whichever leg ran over. That is the black band, the mesh a
       * body walks on reaches the mouth, the picture of it stops short, and
       * the rails cross the gap because they are a different object that
       * never overran.
       *
       * The cull alone was not safe either: it bakes one camera's answer into
       * a kept picture. Both together are, a bounded number of commands, and
       * a picture that is never more than fifteen metres out of date.
       */
      const leg = asLeg(run.places.get(id));
      if (!leg || !this.sees(leg)) continue;
      const c = leg.cor;
      const STEP = C.M(3);
      /**
       * THE DARK MIDDLE IS ONE SHAPE. Between the two lit mouths the rock is
       * a constant three metres and the floor one colour, so every step
       * there was the same quad again: a kilometre of bore was seven
       * thousand retained commands, re-tessellated every frame (from play
       * 2026-09-16, 37,900 commands and a 20 ms frame with the simulation
       * at 1 ms). The steps still trace the curve, they become the points
       * of a polygon, and only where the light varies near a mouth does a
       * quad get its own fill.
       */
      const strip = new Strip(g);
      for (let s = c.s0; s < c.s1; s += STEP) {
        const to = Math.min(s + STEP, c.s1);
        // ...and only the stretch on camera, not the whole leg one end of
        // which happens to be in view
        if (!this.inView(fromLeg(leg, s, 0))) {
          strip.flush();
          continue;
        }
        const litAt = (at: number) => 1 - Math.min(1, Math.min(at - c.s0, c.s1 - at) / MOUTH_LIGHT);
        const lit = litAt(s);
        const litTo = litAt(to);
        const a = leg.arcBand(s);
        const b = leg.arcBand(to);
        if (lit === 0 && litTo === 0) {
          // the dark middle: three metres of rock, the bore's own colour
          strip.add(
            fromLeg(leg, s, a.top - C.M(3)),
            fromLeg(leg, s, a.bottom + C.M(3)),
            fromLeg(leg, s, a.top),
            fromLeg(leg, s, a.bottom),
            () => [fromLeg(leg, to, b.top - C.M(3)), fromLeg(leg, to, b.bottom + C.M(3))],
            () => [fromLeg(leg, to, b.top), fromLeg(leg, to, b.bottom)],
          );
          continue;
        }
        strip.flush();
        const quad = (t0: number, t1: number, u0: number, u1: number) => {
          const q0 = fromLeg(leg, s, t0);
          const q1 = fromLeg(leg, to, u0);
          const q2 = fromLeg(leg, to, u1);
          const q3 = fromLeg(leg, s, t1);
          g.beginPath();
          g.moveTo(q0.x, q0.y);
          g.lineTo(q1.x, q1.y);
          g.lineTo(q2.x, q2.y);
          g.lineTo(q3.x, q3.y);
          g.closePath();
          g.fillPath();
        };
        // THE ROCK THE TUBE IS CUT THROUGH, flaring into the station as far
        // as that station's own wall stands back (render/tunnelArt.ts), and
        // the floor lifting toward the deck's tone over the reach of the
        // station's light, so a mouth is not an edge (from play 2026-09-11
        // and 2026-09-12; the history is in git).
        const wall = hall(run, leg, s) - C.M(3);
        const f0 = C.M(3) + wall * lit;
        const f1 = C.M(3) + wall * litTo;
        g.fillStyle(ROCK, 1);
        quad(a.top - f0, a.bottom + f0, b.top - f1, b.bottom + f1);
        g.fillStyle(mix(BORE, DECK, lit * 0.8), 1);
        quad(a.top, a.bottom, b.top, b.bottom);
      }
      strip.flush();
    }
  }

  /** the seam at each mouth, from the mesh a body actually walks on */
  seam(g: Phaser.GameObjects.Graphics, run: Run) {
    const map = run.map;
    const fill = (p: Patch, color: number) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(p.x[0], p.y[0]);
      for (let i = 1; i < 4; i++) g.lineTo(p.x[i], p.y[i]);
      g.closePath();
      g.fillPath();
    };
    /**
     * ...AND THE SEAM ITSELF FROM THE BAKED MESH. The bore above is drawn
     * from its curve because the mesh is cut every metre and a picture needs
     * nothing so fine. But the curve is the tunnel's IDEA of itself and the
     * mesh is what a body actually walks on, and at a mouth the two only have
     * to disagree by a hair for a black seam to open across the tunnel (from
     * play, repeatedly). Near a mouth, draw the thing the simulation uses:
     * then a gap there is impossible rather than merely unlikely.
     */
    const MOUTH = C.M(30);
    for (const p of map.patches) {
      if (p.kind !== 'bore') continue;
      const leg = asLeg(p.place);
      if (!leg) continue;
      const cx = (p.x0 + p.x1) / 2;
      const cy = (p.y0 + p.y1) / 2;
      // only the mouths on camera: this pass alone was 6,500 commands at
      // Åkeshov, most of them at mouths kilometres away (2026-09-16)
      if (!this.inView({ x: cx, y: cy })) continue;
      let near = Infinity;
      for (const end of [leg.cor.s0, leg.cor.s1]) {
        const m = fromLeg(leg, end, 0);
        near = Math.min(near, Math.hypot(m.x - cx, m.y - cy));
      }
      if (near > MOUTH) continue;
      // lit the same way the curve-drawn bore is, so the two are one surface
      fill(p, mix(BORE, DECK, (1 - near / MOUTH_LIGHT) * 0.8));
    }
  }

  /**
   * WHAT IS IN A TUNNEL: its rails, and its dark.
   *
   * Drawn along the bore's real curve, from the same track profiles the
   * traffic runs on (sim/boreTracks.ts), so the rails a train stands on are
   * the rails you can see, which is the thing that was never true when a
   * platform and a bore each drew their own.
   *
   * The dark belongs to the leg, and lifts at each mouth into the station's
   * light. Nothing about it changes when you arrive anywhere, because it is
   * not hung off whichever room you happen to be in.
   */
  rails(g: Phaser.GameObjects.Graphics, run: Run, cam: Box | null) {
    this.cam = cam;
    const STEP = C.M(3);
    for (const id of run.live) {
      const leg = asLeg(run.places.get(id));
      // ...and only the bores on camera, exactly as the floor above: the
      // rails were every live leg's, some 2,700 quads a frame against the
      // floor's few hundred (found in review, 2026-09-15)
      if (!leg || !this.sees(leg)) continue;
      const c = leg.cor;
      // the rails, finely, a tunnel that bends should LOOK bent, not
      // polygonal. It is affordable because this is drawn once and kept, not
      // re-emitted every frame, and because a bore the camera cannot see is
      // not drawn at all.
      // ...AND IN THE SAME LANGUAGE THE STATION USES. A station lays its rails
      // as a pair of dark bands either side of the track's centre
      // (render/stationBuilder.ts), and the bore was drawing a pair of thin
      // pale lines. They are the same rails: one runs into the other at the
      // mouth, and drawn as two different things they simply stopped there
      // (from play 2026-09-11: "the tracks don't meet").
      g.fillStyle(RAIL, 0.5);
      for (const track of boreTracks(leg)) {
        for (const off of [-15, 11]) {
          // one polygon per rail per stretch on camera: its two edges are
          // the steps along the curve, forward on one side and back on the
          // other. A quad per step was four fills every three metres.
          let near: { x: number; y: number }[] = [];
          let far: { x: number; y: number }[] = [];
          let last: number | null = null;
          const flush = () => {
            if (last !== null && near.length) {
              const t1 = track(last);
              near.push(fromLeg(leg, last, t1 + off));
              far.push(fromLeg(leg, last, t1 + off + 2));
              g.beginPath();
              g.moveTo(near[0].x, near[0].y);
              for (let i = 1; i < near.length; i++) g.lineTo(near[i].x, near[i].y);
              for (let i = far.length - 1; i >= 0; i--) g.lineTo(far[i].x, far[i].y);
              g.closePath();
              g.fillPath();
            }
            near = [];
            far = [];
            last = null;
          };
          for (let s = c.s0; s < c.s1; s += STEP) {
            const to = Math.min(s + STEP, c.s1);
            if (!this.inView(fromLeg(leg, s, 0))) {
              flush();
              continue;
            }
            const t0 = track(s);
            near.push(fromLeg(leg, s, t0 + off));
            far.push(fromLeg(leg, s, t0 + off + 2));
            last = to;
          }
          flush();
        }
      }
    }
  }

  /** is this point of the bore within the camera's reach, plus the margin
   * the picture is allowed to go stale by before it is redrawn */
  private inView(p: { x: number; y: number }): boolean {
    const c = this.cam;
    if (!c) return true;
    return p.x > c.x0 - VIEW_PAD && p.x < c.x1 + VIEW_PAD && p.y > c.y0 - VIEW_PAD && p.y < c.y1 + VIEW_PAD;
  }

  /** is any of this bore on screen? A leg is hundreds of metres long, so ask
   * about its box rather than its ends */
  private sees(leg: { cor: { pts: { x: number; y: number }[] } }): boolean {
    if (!this.cam) return true;
    const pad = VIEW_PAD;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of leg.cor.pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return (
      x1 + pad > this.cam.x0 && x0 - pad < this.cam.x1 && y1 + pad > this.cam.y0 && y0 - pad < this.cam.y1
    );
  }
}

/**
 * A RUN OF THE BORE'S DARK MIDDLE, gathered into two polygons, the rock
 * and the floor, instead of a pair of quads per step.
 */
class Strip {
  private rockTop: { x: number; y: number }[] = [];
  private rockBottom: { x: number; y: number }[] = [];
  private floorTop: { x: number; y: number }[] = [];
  private floorBottom: { x: number; y: number }[] = [];
  private end: { rock: () => { x: number; y: number }[]; floor: () => { x: number; y: number }[] } | null =
    null;

  constructor(private readonly g: Phaser.GameObjects.Graphics) {}

  /** one step's near edge, and how to close the far edge if it is the last */
  add(
    rockTop: { x: number; y: number },
    rockBottom: { x: number; y: number },
    floorTop: { x: number; y: number },
    floorBottom: { x: number; y: number },
    rockEnd: () => { x: number; y: number }[],
    floorEnd: () => { x: number; y: number }[],
  ) {
    this.rockTop.push(rockTop);
    this.rockBottom.push(rockBottom);
    this.floorTop.push(floorTop);
    this.floorBottom.push(floorBottom);
    this.end = { rock: rockEnd, floor: floorEnd };
  }

  flush() {
    if (this.end) {
      const [rt, rb] = this.end.rock();
      const [ft, fb] = this.end.floor();
      this.rockTop.push(rt);
      this.rockBottom.push(rb);
      this.floorTop.push(ft);
      this.floorBottom.push(fb);
      this.g.fillStyle(ROCK, 1);
      this.poly(this.rockTop, this.rockBottom);
      this.g.fillStyle(BORE, 1);
      this.poly(this.floorTop, this.floorBottom);
    }
    this.rockTop = [];
    this.rockBottom = [];
    this.floorTop = [];
    this.floorBottom = [];
    this.end = null;
  }

  private poly(top: { x: number; y: number }[], bottom: { x: number; y: number }[]) {
    const g = this.g;
    g.beginPath();
    g.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i].x, top[i].y);
    for (let i = bottom.length - 1; i >= 0; i--) g.lineTo(bottom[i].x, bottom[i].y);
    g.closePath();
    g.fillPath();
  }
}

/**
 * HOW FAR BACK THE WALL STANDS at the station this stretch of bore is nearest,
 * half the height of that room, which is what the picture of it fills.
 */
function hall(run: Run, leg: { cor: { a: string; b: string; s0: number; s1: number } }, s: number): number {
  const near = s - leg.cor.s0 < leg.cor.s1 - s ? leg.cor.a : leg.cor.b;
  const st = asStation(run.places.get(Station.idOf(near)));
  if (!st) return C.M(3);
  return Math.max(C.M(3), (st.worldBottomY - st.worldTopY) / 2);
}

/** k of the way from one colour to another, channel by channel */
function mix(from: number, to: number, k: number): number {
  const f = [(from >> 16) & 255, (from >> 8) & 255, from & 255];
  const t = [(to >> 16) & 255, (to >> 8) & 255, to & 255];
  const c = f.map((v, i) => Math.round(v + (t[i] - v) * k));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
