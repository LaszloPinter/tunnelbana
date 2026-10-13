import * as C from '../config.ts';
import { mulberry32 } from '../core/lineData.ts';
import { datan2 } from './det.ts';
import { boreEnvelopeAt, mouthBlendOf } from '../core/boreEnvelope.ts';
import { boreWallOf } from '../core/boreSlots.ts';
import {
  corridorProject,
  legIsOpen,
  recessAt,
  recessBump,
  recessCentres,
  RECESS_DEPTH,
  type Corridor,
} from '../core/corridor.ts';
import { FLAT_PATH, type PlatformPath } from '../core/platformPath.ts';
import type { Platform, Rail } from '../core/world.ts';
import type { Box, StationPlan } from './stationPlan.ts';
import { stationSeed } from './stationPlan.ts';
import type { AcidPool, Boarding, Enemy, Loot, Proj, Strike } from '../combat/types.ts';
import type { Band, Place } from './place.ts';
import { legIdOf } from './leg.ts';

/**
 * A LEG, as a place (§17).
 *
 * The tunnel between two platforms, and a room in its own right: its own
 * floor, its own horde, its own bolts, its own dark. Its x is ARC LENGTH
 * along the bore's centreline and its y is the lateral across it, which
 * makes it a very long, very thin room in the same flat plane every other
 * place uses, so the horde, the projectiles, the loot and the shields work
 * out here without knowing they are in a tunnel.
 *
 * Nothing is unrolled into a station's chart any more, and a walker's
 * position is kept ONCE. Which end you entered by decides nothing.
 *
 * ---- geometry ----
 *
 * The wall profile is fixed at build time. `corridorHalf` needs both end
 * stations (a bore opens out to the full width of the platform it joins), so
 * the two mouth half-widths are measured once, when the leg is built, and
 * everything after that is pure arithmetic on the corridor, which is what
 * lets a leg be built on demand like a station, and stay a function of its
 * own identity rather than of when it happened to be needed.
 */
/** 0 at a mouth, 1 a blend-length in, the one curve the bore opens along */
function easeIn(d: number, blend: number): number {
  const f = Math.min(1, Math.max(0, d) / blend);
  return f * f * (3 - 2 * f);
}

export class Leg implements Place {
  readonly kind = 'leg' as const;
  readonly cor: Corridor;
  readonly id: string;
  readonly name: string;
  readonly levelIndex: number; // the a-end storey; the tube carries both (core/tube.ts)
  /** in the open (an embankment or a bridge) rather than bored rock */
  readonly open: boolean;

  // ---- the floor ----
  enemies: Enemy[] = [];
  projs: Proj[] = [];
  coins: Loot[] = [];
  pickups: Loot[] = [];
  stains: Loot[] = [];
  acidPools: AcidPool[] = [];
  strikes: Strike[] = [];
  boardings: Boarding[] = [];

  // ---- a leg has none of the station's furniture ----
  rails: Rail[] = [];
  platforms: Platform[] = [];
  pillars: Box[] = [];
  benches: Box[] = [];
  passages: { x0: number; x1: number }[] = [];
  escalators: { x: number; y: number }[] = [];
  shafts: { x: number; y: number; w: number; h: number; delta: -1 | 1 }[] = [];
  manaMachines: { x: number; y: number }[] = [];
  healthMachines: { x: number; y: number }[] = [];
  kiosks: { x: number; y: number }[] = [];
  plan: StationPlan | null = null;
  path: PlatformPath = FLAT_PATH;

  // ---- what is happening here ----
  /** the tunnel has answered once: its ambush has sprung (tunnelEvents.ts) */
  cleared = false;
  corruption = 0;
  buildGen = 0;
  worldTopY = 0;
  worldBottomY = 0;

  readonly rng: () => number;
  /** how far the bore opens at each mouth, either side, in the leg's lateral */
  private spanA: { lo: number; hi: number };
  private spanB: { lo: number; hi: number };
  /** the builds the spans were measured off, so a re-laid storey re-measures */
  private measuredAt = '';
  private readonly wall: number;

  constructor(
    cor: Corridor,
    mouthSpanA: { lo: number; hi: number },
    mouthSpanB: { lo: number; hi: number },
    runSeed = 1,
  ) {
    this.cor = cor;
    this.id = legIdOf(cor);
    this.name = `${cor.a} – ${cor.b}`;
    this.levelIndex = cor.la;
    this.open = legIsOpen(cor);
    this.spanA = mouthSpanA;
    this.spanB = mouthSpanB;
    this.wall = boreWallOf(cor);
    this.rng = mulberry32((stationSeed(this.id) ^ Math.imul(runSeed, 0x9e3779b1) ^ 0x5eed1e6) | 0);
    const widest =
      Math.max(-mouthSpanA.lo, mouthSpanA.hi, -mouthSpanB.lo, mouthSpanB.hi, this.wall) +
      RECESS_DEPTH +
      C.M(2);
    this.worldTopY = -widest;
    this.worldBottomY = widest;
  }

  /**
   * RE-MEASURE THE MOUTHS if either platform has been re-laid: a bore opens
   * out to the floor of the storey it meets, and a storey change under a leg
   * leaves its shape describing a platform that is no longer there. A new
   * shape is a new floor, so it counts as a build (world/live.ts).
   */
  remeasure(a: { lo: number; hi: number }, b: { lo: number; hi: number }, stamp: string): boolean {
    if (stamp === this.measuredAt) return false;
    this.measuredAt = stamp;
    this.buildGen += 1;
    this.spanA = a;
    this.spanB = b;
    const widest = Math.max(-a.lo, a.hi, -b.lo, b.hi, this.wall) + RECESS_DEPTH + C.M(2);
    this.worldTopY = -widest;
    this.worldBottomY = widest;
    return true;
  }

  /** a leg's own axes ARE arc along the bore and lateral across it: a point
   * of the room, said as arc and lateral */
  arcOf(x: number): number {
    return x;
  }
  latOf(y: number): number {
    return y;
  }
  /** ...and back */
  xOf(s: number): number {
    return s;
  }
  yOf(t: number): number {
    return t;
  }

  /** the two mouths, this room's walkable x span (place.ts Place) */
  get x0(): number {
    return Math.min(this.xOf(this.cor.s0), this.xOf(this.cor.s1));
  }
  get x1(): number {
    return Math.max(this.xOf(this.cor.s0), this.xOf(this.cor.s1));
  }
  /** the same span, under the name the combat system asks for a room's ends by */
  get platformX0(): number {
    return this.x0;
  }
  get platformX1(): number {
    return this.x1;
  }

  /**
   * THE BORE'S HALF-WIDTH at arc `x`. A bore is a narrow tube, but at each
   * mouth it opens out to the full width of the platform it joins, so
   * stepping off a platform into a leg is continuous, you keep your place on
   * the tracks instead of being snapped into a centred tube.
   */
  /** THE BORE'S WALLS at arc `s`, in the bore's own across-measure: a
   * description of the tunnel's SHAPE, which the 2-D world asks about a point
   * it has already projected onto the curve (src/world/floor.ts) */
  arcBand(s: number): Band {
    const w = this.arcWallAt(s);
    const out = this.arcRefuge(s);
    return { top: w.top - out, bottom: w.bottom + out };
  }

  private arcWallAt(x: number): Band {
    const c = this.cor;
    const ka = 1 - easeIn(x - c.s0, mouthBlendOf(c, c.a));
    const kb = 1 - easeIn(c.s1 - x, mouthBlendOf(c, c.b));
    // ...and never narrower than the tracks it carries: a band far off the
    // bore's centre swings in over a longer crossover than this blend, and
    // the tunnel has to hold it (core/boreEnvelope.ts).
    //
    // That clamp is SYMMETRIC, and a mouth is not: at T-Centralen the bore
    // meets the platform beside the lower track, with four times as much
    // floor above it as below. Applied at the mouth it opened the near side
    // back out to the far side's width, fourteen metres of floor the
    // station does not have. It fades out as the mouth's own span fades in;
    // in the blend the span already covers the tracks, because it is built
    // from the very bands they swing to.
    const holds = (boreEnvelopeAt(c, x) + C.CAR_WIDTH / 2 + C.M(0.6)) * (1 - Math.max(ka, kb));
    const top = Math.min(
      -this.wall + (this.spanA.lo + this.wall) * ka,
      -this.wall + (this.spanB.lo + this.wall) * kb,
      -holds,
    );
    const bottom = Math.max(
      this.wall + (this.spanA.hi - this.wall) * ka,
      this.wall + (this.spanB.hi - this.wall) * kb,
      holds,
    );
    return { top, bottom };
  }

  /** the walls at a point of the SHARED frame */
  wallAt(x: number): Band {
    return this.band(this.arcWallAt(this.arcOf(x)));
  }

  /** the widest the bore gets here, for whatever wants one number. A
   * half-width is a distance, so no sign touches it. */
  half(x: number): number {
    const w = this.arcWallAt(this.arcOf(x));
    return Math.max(-w.top, w.bottom);
  }

  /** a band of the bore's own lateral, said in the shared frame, and put
   * back the right way up, since a mirrored leg swaps its walls over */
  private band(b: Band): Band {
    const a = this.yOf(b.top);
    const c = this.yOf(b.bottom);
    return { top: Math.min(a, c), bottom: Math.max(a, c) };
  }

  /**
   * How far the wall is cut back here: an alcove, or, on an open leg, a
   * walkway the whole way along.
   *
   * IT FADES INTO THE PLATFORM IT MEETS. A bore already opens out to the
   * width of the station's track area at each mouth (`half`); adding a flat
   * walkway on top of that put the walkable floor four metres OUTSIDE
   * anything the station has, at every mouth on the network. You could stand
   * below the lowest bed, and stepping across was then a shove onto the
   * nearest floor (from play 2026-09-07: "I cannot be that low there").
   * A bored leg needs no such taper: its alcoves start 45 m in.
   */
  private arcRefuge(x: number): number {
    if (!this.open) return recessBump(this.cor, x);
    const c = this.cor;
    const k = Math.min(easeIn(x - c.s0, mouthBlendOf(c, c.a)), easeIn(c.s1 - x, mouthBlendOf(c, c.b)));
    return RECESS_DEPTH * k;
  }

  /** how far the wall is cut back at a point of the shared frame */
  refuge(x: number): number {
    return this.arcRefuge(this.arcOf(x));
  }

  /** the floor between the walls, the alcoves included, since you can stand in one */
  bandAt(x: number): Band {
    return this.band(this.arcBand(this.arcOf(x)));
  }

  /** past the wall line, in the alcove itself, where the trains stand down */
  /** ...for a body standing at a point on the MAP: projected onto the bore
   * first. The arc-and-lateral form below is for callers that already have
   * the bore's own numbers (the walker's warning, the ambush). */
  inRefugeAt(x: number, y: number, r: number): boolean {
    const p = corridorProject(this.cor, x, y);
    return this.inRefuge(p.s, p.t, r);
  }

  inRefuge(x: number, y: number, r: number): boolean {
    const s = this.arcOf(x);
    const t = this.latOf(y);
    const w = this.arcWallAt(s);
    const past = t < 0 ? t <= w.top + r * 0.5 : t >= w.bottom - r * 0.5;
    return this.open ? past : recessAt(this.cor, s) && past;
  }

  /**
   * WHICH PLATFORM IS AT THIS END of the bore, in the shared frame. Not the
   * same question as `cor.a` or `cor.b`: half the legs in the network are
   * turned end for end when they are laid out, and then the station at the
   * low-x mouth is the corridor's `b`. Asking the corridor instead of the
   * layout is how a walker steps out of the wrong end of a tunnel.
   */
  nameAtEnd(e: 1 | -1): string {
    const aLow = this.xOf(this.cor.s0) <= this.xOf(this.cor.s1);
    return e < 0 ? (aLow ? this.cor.a : this.cor.b) : aLow ? this.cor.b : this.cor.a;
  }

  /** is there an alcove at this point of the shared frame? */
  recessAt(x: number): boolean {
    return recessAt(this.cor, this.arcOf(x));
  }
  /** the alcoves' middles, in the shared frame */
  recessCentres(): number[] {
    return recessCentres(this.cor).map((s) => this.xOf(s));
  }
  /** the bore's own half-gauge, a width, so sign-free */
  get gauge(): number {
    return this.wall;
  }

  // ---- a leg is straight, and has no islands ----
  worldY(_x: number, y: number): number {
    return y;
  }
  pathYAt(_x: number, wy: number): number {
    return wy;
  }
  pathOffsetAt(): number {
    return 0;
  }
  drawAngle(_x: number, dx: number, dy: number): number {
    return datan2(dy, dx);
  }
  platformAt(): number {
    return -1;
  }
  railBedAt(): number {
    return -1;
  }
  pillarAt(): boolean {
    return false;
  }
  /** everywhere in a leg is tunnel */
  inTunnelX(): boolean {
    return true;
  }

  get er(): number {
    return C.M(0.5);
  }
}
