/**
 * Arithmetic that gives the same answer on every machine.
 *
 * Four-player lockstep means every client simulates the whole game from the
 * same seed and the same inputs, and the moment two of them disagree by one
 * bit the runs drift apart and never come back. So the simulation may only use
 * operations that IEEE 754 pins down exactly.
 *
 * What is safe: + - * / and `Math.sqrt`. The standard requires all five to be
 * correctly rounded, so they are bit-identical everywhere.
 *
 * What is NOT: `Math.sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log` and
 * `hypot`. The spec calls these "implementation-approximated" and lets every
 * engine choose its own algorithm, V8, SpiderMonkey and JavaScriptCore
 * genuinely differ in the last bits, and V8 has changed its own answers
 * between versions. A game that leans on them, as this one does in aiming,
 * knockback, patrol and every distance test, cannot be run in lockstep.
 *
 * So the sim uses these instead: polynomials over the safe five. They are
 * accurate to roughly a hundredth of a pixel over the distances this game
 * works at, which is far below anything a player could see, and, the whole
 * point, they are the SAME hundredth everywhere.
 *
 * The renderer is not bound by any of this. Pulsing alphas and throbbing
 * scales can call Math.sin all day: nothing downstream of them affects what
 * the simulation thinks happened.
 */

const PI = Math.PI;
const TWO_PI = 2 * PI;
const HALF_PI = PI / 2;

/**
 * Distance. sqrt is correctly rounded, so this is exact where Math.hypot,
 * which is free to do its own overflow-avoiding scaling, is not. The game
 * works in pixels over a world a few tens of thousands wide, so the squares
 * cannot overflow and the careful version buys nothing.
 */
export const dist = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** and the squared form, for comparisons that never need the root at all */
export const dist2 = (x: number, y: number): number => x * x + y * y;

/**
 * Sine and cosine, by Taylor series on a reduced argument.
 *
 * x is folded down to an OCTANT, [0, pi/4], because that is as far as these
 * series stay accurate: taken to pi/2 instead, the cosine series is only good
 * to about 5e-7, which is visible drift over a long run. Inside the octant the
 * error is under 1e-12. Every step of the fold is + - * or /, so two machines
 * fold identically.
 */
const QUARTER_PI = PI / 4;

/* eslint-disable no-loss-of-precision -- truncated series coefficients are
   parsed to identical bits everywhere (IEEE 754 pins the conversion); accuracy
   is measured by scripts/check-det.mjs, not by how many digits are written. */

/** cos on [0, pi/4] */
function cosPoly(r: number): number {
  const r2 = r * r;
  return (
    1 +
    r2 *
      (-0.5 +
        r2 *
          (0.041666666666666664 +
            r2 * (-0.001388888888888889 + r2 * (0.0000248015873015873 + r2 * -2.7557319223985893e-7))))
  );
}

/** sin on [0, pi/4] */
function sinPoly(r: number): number {
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (-0.16666666666666666 +
          r2 *
            (0.008333333333333333 +
              r2 * (-0.0001984126984126984 + r2 * (2.755731922398589e-6 + r2 * -2.505210838544172e-8)))))
  );
}

export function dsin(x: number): number {
  return dcos(x - HALF_PI);
}

export function dcos(x: number): number {
  // fold to [-pi, pi], then to [0, pi] since cos is even
  let r = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  if (r < 0) r = -r;
  // cos(pi - r) = -cos(r) brings it inside [0, pi/2]
  let sign = 1;
  if (r > HALF_PI) {
    r = PI - r;
    sign = -1;
  }
  // and the last octant swaps to sine: cos(r) = sin(pi/2 - r)
  return sign * (r > QUARTER_PI ? sinPoly(HALF_PI - r) : cosPoly(r));
}

/**
 * Arctangent of y/x with the quadrant, from an odd minimax polynomial on
 * [-1, 1] and the usual reflections. Accurate to about 1e-5 radians, which
 * over the longest shot in the game is a fraction of a pixel.
 */
export function datan2(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  // work with the smaller over the larger, so the polynomial only ever sees [0, 1]
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax;
  const z2 = z * z;
  let a = z * (0.9998660143 + z2 * (-0.3302995 + z2 * (0.180141 + z2 * (-0.085133 + z2 * 0.0208351))));
  if (swap) a = HALF_PI - a;
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

/** Arccosine, via atan2, the only place the sim needs it is shield coverage. */
export function dacos(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return datan2(Math.sqrt(1 - c * c), c);
}

/**
 * The simulation's random numbers.
 *
 * mulberry32: 32-bit state, integer ops only, identical on every engine. One
 * stream per run, advanced only by the simulation, so the same seed and the
 * same inputs give the same run, which is what makes both lockstep and
 * replay-validated leaderboards possible. Anything cosmetic must NOT draw from
 * it, or one client's extra spark rotates everybody's next enemy roll.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** an integer in [lo, hi], inclusive, from a sim stream */
export const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** a number in [lo, hi) from a sim stream */
export const randRange = (rng: () => number, lo: number, hi: number): number => lo + rng() * (hi - lo);

// ---- the small helpers the simulation used to borrow from Phaser.Math ----
// Not because Phaser's are wrong, Clamp and Linear are the obvious
// expressions and agree everywhere, but so that src/combat/ imports nothing
// from the engine at all, which is what lets it run where there is no engine.

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => (b - a) * t + a;

/** an angle brought into [-π, π), exactly as Phaser.Math.Angle.Wrap does it */
export function wrapAngle(a: number): number {
  const range = Math.PI * 2;
  return -Math.PI + ((((a + Math.PI) % range) + range) % range);
}

/**
 * A SEED FROM A NAME. Content that must be a function of the run's seed and
 * nothing else, what a wave holds, what a kiosk stocks, what a level-up
 * offers, draws from a stream keyed by its own identity rather than from
 * the run's one shared stream, where the count of draws before it (every
 * crit, every wander) would move it (from play 2026-09-04: "everything must
 * be seeded").
 */
export function seedOf(runSeed: number, key: string): number {
  let h = (runSeed * 2654435761) | 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h ^ key.charCodeAt(i), 16777619) + 0x9e3779b9) | 0;
  return h;
}
