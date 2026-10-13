import * as C from '../config.ts';
import { type CombatHost, type Enemy } from './types.ts';
import { clamp, dist } from '../sim/det.ts';

/**
 * THE LINES (from play: however they spawned, the horde converged into one
 * frontal blob on the pierce line, and a golden-angle fan that collapsed
 * near the target was too subtle to read). Each mob rolled an `approach` at
 * spawn; this bends where it is walking to. The target is untouched, who it
 * is after is decided above, the same on every client.
 */
export function approachTarget(
  ctx: CombatHost,
  e: Enemy,
  px: number,
  py: number,
  now: number,
): { x: number; y: number } {
  const dx = px - e.x;
  const dy = py - e.y;
  const d = dist(dx, dy);
  // the last two metres are the bite: everyone goes straight
  if (d < C.M(2) || e.approach === 'rush') return { x: px, y: py };
  const ux = dx / d;
  const uy = dy / d;
  // the perpendicular, on this one's side
  const sx = -uy * e.approachSide;
  const sy = ux * e.approachSide;
  /**
   * ON THE MAP a line is drawn on the FLOOR. A room's span is a set of
   * numbers in that room's own chart, and a waypoint clamped into them is a
   * waypoint at the map's origin, which is where the whole horde walked
   * (from play 2026-09-10: "enemies are going the wrong way"). Out here the
   * only question worth asking about a point is whether there is ground
   * under it; if there is not, the line straightens to the target, which is
   * somewhere a body is standing and so is certainly ground.
   */
  const inside = (x: number, y: number) => (ctx.run.map.at(x, y) ? { x, y } : { x: px, y: py });
  switch (e.approach) {
    case 'jink': {
      // leans off the line, and re-rolls the lean at a random beat: a
      // zig-zag with no period to time. Aimed a few metres ahead so the lean
      // is a lean of direction, not of a far-off target
      if (now >= e.approachAt) {
        e.approachAt = now + 300 + ctx.run.rng() * 600;
        e.approachLean = (ctx.run.rng() * 2 - 1) * 1.3;
      }
      const w = e.approachLean;
      const ahead = Math.min(d, C.M(3));
      return { x: e.x + (ux + sx * w) * ahead, y: e.y + (uy + sy * w) * ahead };
    }
    case 'tunnel':
      // on the map there is no bed to aim for, a mob walks over the edge
      // and down onto the tracks wherever it likes (src/world/body2d.ts), so
      // the line that used to reach for one is a rush
      return { x: px, y: py };
    case 'flank': {
      // stage 0: a point past you, off to the side, it runs by and comes
      // in from behind. Reaching it, or you turning to face it, ends the
      // run-by and it closes like anything else
      if (e.approachStage === 0) {
        const m = e.approachMag;
        const wp = inside(px + ux * m + sx * m, py + uy * m + sy * m);
        const wd = dist(wp.x - e.x, wp.y - e.y);
        // arrived past you, or ended up at your side anyway: close in
        if (wd < C.M(1.2) || d < C.M(2.5)) e.approachStage = 1;
        else return wp;
      }
      return { x: px, y: py };
    }
    case 'arc': {
      // a wide line to one side that only closes over the last four metres:
      // it comes at you from the flank, curling in
      const hold = clamp((d - C.M(2)) / C.M(4), 0, 1);
      const off = e.approachMag * hold;
      return inside(px + sx * off, py + sy * off);
    }
    default:
      return { x: px, y: py };
  }
}

/**
 * THE RHYTHM (types.ts `Tempo`), as a factor on this tick's pace. From play:
 * a horde at one constant speed is a horde you can time. The stalker is the
 * Fallen's lunge, prowl, a beat of stillness that IS the tell, then twice
 * pace, and the skitterer never keeps the same gap twice. Every beat is
 * rolled from the run's rng, so all four clients see the same lunge.
 */
export function tempoPace(ctx: CombatHost, e: Enemy, now: number, d: number): number {
  if (e.tempo === 'stalker') {
    // tuned from play: 2.1× for half a second was a comical hop. The lunge
    // is THREE times pace for about a second, a plain vätte covers 12–19 m,
    // a brute 9–14, and it starts from farther out
    if (e.tempoState === 0) {
      if (d < C.M(13) && now >= e.tempoAt) {
        e.tempoState = 1;
        e.tempoAt = now + 260 + ctx.run.rng() * 240;
      }
      return 0.65;
    }
    if (e.tempoState === 1) {
      if (now >= e.tempoAt) {
        e.tempoState = 2;
        e.tempoAt = now + 900 + ctx.run.rng() * 500;
      }
      return 0;
    }
    if (now >= e.tempoAt) {
      e.tempoState = 0;
      e.tempoAt = now + 1000 + ctx.run.rng() * 1600;
    }
    return 3;
  }
  if (e.tempo === 'skitter') {
    if (now >= e.tempoAt) {
      if (e.tempoState === 0) {
        e.tempoState = 1;
        e.tempoAt = now + 160 + ctx.run.rng() * 420;
      } else {
        e.tempoState = 0;
        e.tempoAt = now + 450 + ctx.run.rng() * 900;
      }
    }
    return e.tempoState === 1 ? 0 : 1.35;
  }
  return 1;
}
