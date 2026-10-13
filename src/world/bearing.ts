import * as C from '../config.ts';
import { corridorPos, corridorProject } from '../core/corridor.ts';
import { asLeg, asStation } from '../sim/place.ts';
import { frameOf } from '../core/worldNet.ts';
import { seatHeading } from './trainSeat.ts';
import type { Player } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';
import { datan2 } from '../sim/det.ts';

/**
 * WHICH WAY THE WORLD RUNS, where you are standing.
 *
 * Stockholm is a map and its platforms lie at every angle, so a fixed view
 * shows most of them as a diagonal, which is honest and hard to read. The
 * camera turns with the world instead: the platform you are on lies across
 * the screen, the tunnel you are walking runs across it, and the train you
 * are riding runs across it. The world turns about you on a ride, and that is
 * exactly what riding a train through a curve looks like from a seat.
 *
 * It is only a camera. Nothing in the simulation knows about it; the keys are
 * turned by the same angle so W is toward the top of the screen whatever
 * bearing that is in the city (scenes/input.ts).
 */
export function bearingAt(run: Run, p: Player): number | null {
  if (p.frame.kind !== 'world') {
    // THE CAR'S OWN HEADING, always. It is a continuous thing, the line's
    // tangent, which never jumps, so the view never lurches while you ride.
    // Taking the PLATFORM's bearing while a train stands at one seemed right
    // (a station is what has a top) but it is a second source, and the swap
    // back at the moment of departure threw the world round and back again
    // (from play 2026-09-11). It is not needed either: a train at rest is
    // parallel to its platform to 0.0° at every stop on the network, now that
    // a track's heading includes the crossover it is standing on
    // (core/linePath.ts pathPos).
    const jid = p.frame.jid;
    const head = jid ? seatHeading(jid, p.frame.rx, run.gameNow) : null;
    return head ? datan2(head.ty, head.tx) : null;
  }
  const on = run.map.at(p.x, p.y);
  if (!on) return null;
  const leg = asLeg(on.place);
  if (leg) {
    /**
     * THE BORE'S DIRECTION WHERE YOU ARE STANDING, taken over a few metres of
     * it. It used to be taken over ONE PIXEL either side, and from the raw
     * polyline vertices rather than from the curve, so both samples usually
     * landed on the same vertex and the answer was whatever that segment
     * happened to be, quantised and jumping from step to step. Walking out of
     * a station swung the world (from play 2026-09-11: "as soon as I set foot
     * in the tunnel it turns significantly").
     */
    const near = corridorProject(leg.cor, p.x, p.y);
    const span = C.M(6);
    const s0 = Math.max(leg.cor.s0, near.s - span);
    const s1 = Math.min(leg.cor.s1, near.s + span);
    const p0 = corridorPos(leg.cor, s0);
    const p1 = corridorPos(leg.cor, s1);
    return datan2(p1.y - p0.y, p1.x - p0.x);
  }
  const st = asStation(on.place);
  const f = st && frameOf(st.name, st.levelIndex);
  return f ? datan2(f.uy, f.ux) : null;
}

/** turn a little of the way toward an angle, the short way round */
export function easeAngle(from: number, to: number, k: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

/**
 * Turn the view a little further toward the world's bearing, and hand back
 * where it got to.
 *
 * A HALF-TURN IS THE SAME LINE: a platform's axis may be written either way
 * round and a train may run either way along it, and rolling the whole world
 * over to follow that would be violent and mean nothing. Take whichever of
 * the two the view is already nearer.
 */
export function turnCamera(
  run: Run,
  p: Player,
  now: number,
  cam: { setRotation(a: number): unknown },
  /** how fast to turn, a run's opening creeps (render/arrival.ts) */
  ease = 0.12,
): number {
  const want = bearingAt(run, p);
  if (want === null) return now;
  const straight = easeAngle(now, want, 1) - now;
  const to = Math.abs(straight) > Math.PI / 2 ? want + Math.PI : want;
  const at = easeAngle(now, to, ease);
  // A CAMERA TURNS THE OTHER WAY FROM THE WORLD IT LOOKS AT: to bring a line
  // lying at `at` across the screen, the view is rolled back by that much.
  cam.setRotation(-at);
  return at;
}
