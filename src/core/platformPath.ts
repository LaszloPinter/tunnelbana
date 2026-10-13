import * as C from '../config.ts';
import type { StationGeo } from '../data/stationGeometry.ts';
import { datan2 } from '../sim/det.ts';

/**
 * The station's centreline, and the tunnels either side of it, as the rest of
 * the game sees them: how far the track is displaced across at a given world x,
 * and which way it is heading there.
 *
 * The simulation never learns about this. Positions stay path-relative,
 * distance along the platform and offset from its centre, exactly as they have
 * always been, and this maps them to the screen at draw time. So collision,
 * enemy behaviour and the train's 1D physics are untouched by curvature, which
 * is the whole reason §4 specified a swept path in the first place.
 *
 * ---- one curve per leg ----
 *
 * A tunnel is parameterised by the LEG, not by either station: u runs 0..1
 * from the platform behind to the platform ahead over the corridor's own
 * length, so both ends draw the same shape. The curve is a cubic Hermite
 * that leaves at the departing platform's exit slope and arrives at the next
 * platform's entry slope, with a wave through the middle sized by how far the
 * real line turns between the two (data/legs.json). It is a DISPLACEMENT of
 * the unrolled view only: the corridor's own cross-section (src/core/corridor.ts)
 * is what everything in the tunnel is measured against.
 */

/** how far a tunnel wanders sideways on the sharpest turn in the network */

export class PlatformPath {
  /** across-platform displacement in px at each sample, ends first and last */
  private readonly ys: number[];
  private readonly x0: number;
  private readonly x1: number;
  /** slope just inside each end of the platform, measured in +x */
  readonly slope0: number;
  readonly slope1: number;
  readonly flat: boolean;
  /** the largest displacement anywhere on the path, for camera bounds */
  readonly maxOffset: number;
  /** outside [bendFrom, bendTo] the path is dead flat: nothing there needs
   * sweeping, and sweeping it anyway is how the beds cost 40ms a frame */
  readonly bendFrom: number;
  readonly bendTo: number;

  constructor(geo: StationGeo, x0: number, x1: number, strength: number) {
    this.x0 = x0;
    this.x1 = x1;
    this.ys = geo.offsets.map((m) => C.M(m) * strength);
    const n = this.ys.length;
    const step = (x1 - x0) / Math.max(1, n - 1);
    this.slope0 = n > 1 ? (this.ys[1] - this.ys[0]) / step : 0;
    this.slope1 = n > 1 ? (this.ys[n - 1] - this.ys[n - 2]) / step : 0;
    this.flat = this.ys.every((y) => Math.abs(y) < 0.01);
    this.bendFrom = this.flat ? 0 : x0;
    this.bendTo = this.flat ? 0 : x1;
    this.maxOffset = this.ys.reduce((m, y) => Math.max(m, Math.abs(y)), 0);
  }

  /** across-platform displacement in px at world x */
  offsetAt(x: number): number {
    if (this.flat) return 0;
    if (x >= this.x0 && x <= this.x1) {
      const n = this.ys.length;
      const t = ((x - this.x0) / (this.x1 - this.x0)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(t));
      const f = t - i;
      return this.ys[i] * (1 - f) + this.ys[i + 1] * f;
    }
    // BEYOND THE PLATFORM THE CHART IS STRAIGHT: a leg is the corridor
    // unrolled, and both its stations must draw it the same way. A
    // decorative swerve used to bend it here, differently from each end,
    // so a train's tail jumped and the platform arrived at an angle at
    // every handover (from play 2026-09-04). The end offset carries on.
    return x > this.x1 ? this.ys[this.ys.length - 1] : this.ys[0];
  }

  /** the direction the track runs at world x, in radians */
  angleAt(x: number): number {
    if (this.flat) return 0;
    const h = 3;
    return datan2(this.offsetAt(x + h) - this.offsetAt(x - h), 2 * h);
  }
}

/** a path for a station with no curvature at all: the trivial case */
export const FLAT_PATH = new PlatformPath(
  { lengthM: 0, widthM: 0, offsets: [0, 0], bowM: 0, found: false, outdoor: false },
  0,
  1,
  0,
);
