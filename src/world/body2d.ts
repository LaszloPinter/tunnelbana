import * as C from '../config.ts';
import { corridorProject } from '../core/corridor.ts';
import { bodyAt, trainBody } from './trains2d.ts';
import type { Chunks, Found } from './chunks.ts';
import type { RunFacts } from '../combat/types.ts';
import { datan2, dcos, dist, dsin } from '../sim/det.ts';
import { asLeg } from '../sim/place.ts';
import { corridorColours, corridorLevelAt } from '../core/tube.ts';

/**
 * A BODY MOVING ON THE MAP.
 *
 * One position, one world. Walking off the end of a platform puts tunnel
 * under your feet because the tunnel's mouth IS the platform's end, and both
 * are the same ground baked into the same map (src/world/bake.ts). There is
 * no room to leave, no crossing to make, nothing to hand over and no frame to
 * turn a heading into.
 *
 * What is left is the only two rules a floor ever had: you cannot walk where
 * there is no floor, and you cannot walk into a moving train.
 */

/** how far a blocked step may be turned to get round what stopped it, in
 * order, a body follows a wall rather than sticking to it */
const TURNS = [
  Math.PI / 8,
  Math.PI / 4,
  (3 * Math.PI) / 8,
  Math.PI / 2,
  (5 * Math.PI) / 8,
  (3 * Math.PI) / 4,
  (7 * Math.PI) / 8,
  Math.PI,
];

export interface Step {
  x: number;
  y: number;
  on: Found | null;
  /** the metal ran into you, or you into it, and it was moving */
  crushed: boolean;
  /** standing in solid metal that is NOT moving: the doors shut on you (walk2d.ts) */
  inMetal: boolean;
  /** which way the step turned to get round something: 0 when it went straight */
  turn: 1 | -1 | 0;
}

/** may a body go from this ground to that? The one rule a platform's edge
 * ever was: you can always CLIMB OUT of the tracks, that is how you cross
 * to another island, but stepping DOWN off a deck takes a dash or an open
 * door, so nobody falls in by accident. On the map that is not a line at a
 * y-coordinate any more; it is what the ground under you changes to. */
export function mayGo(from: Found | null, to: Found, airborne: boolean): boolean {
  if (airborne || !from) return true;
  return !(from.kind === 'platform' && to.kind === 'bed');
}

/**
 * MAY A BODY STAND HERE, having come from there, THE step rule, in one
 * place. Floor under it; the platform's edge unless a door is open on that
 * track; nothing in the way, unless it is already inside something and must
 * be let out; and not inside a train's flank, which is a wall with doorways.
 *
 * The walker asked this one step at a time and the router (route2d.ts) asked
 * a copy of it ahead of time, a copy that knew the edge but not the door or
 * the metal, so a route to an open door went off the end of the platform,
 * into the bore, and five hundred metres back along the track bed to reach
 * the train from behind (probe ride2d, 0 of 8 boarded, 2026-09-14).
 */
export function stepOk(
  run: RunFacts,
  map: Chunks,
  from: Found | null,
  nx: number,
  ny: number,
  r: number,
  opts: {
    airborne?: boolean;
    stuck?: boolean;
    solidMetal?: boolean;
    inMetal?: boolean;
    wantPlace?: string;
  } = {},
): Found | null {
  // ...asked WITH the room the body is in: where two bores cross they share
  // the ground, and the answer must be the bore you are already in, or,
  // stepping in from a platform, the bore the body is heading for
  const on = map.at(nx, ny, from?.place.id, opts.wantPlace);
  if (!on) return null;
  // TUNNELS DO NOT MEET. Where two bores cross on the map they are one
  // above the other in Stockholm, so a body in one may not step into the
  // other: a walker turned right in a red bore and ran off down a green one
  // (from play 2026-09-24). Where two bores FORK from one platform, the
  // 17 and the 18/19 out of Gullmarsplan, they are one tunnel for a
  // while, and a body may be in either (probe run2d: routes were lost when
  // the rule was absolute). What tells them apart is not the angle (the red
  // and green run in at 8° under Slussen) but the network: bores of one
  // COLOUR that meet at a station on the SAME storey are one tunnel; other
  // colours, other storeys, or meeting nowhere, they only cross.
  if (
    from &&
    from.kind === 'bore' &&
    on.kind === 'bore' &&
    on.place.id !== from.place.id &&
    !oneTunnelHere(from, on, nx, ny)
  )
    return null;
  if (!mayGo(from, on, opts.airborne ?? false) && !(on.kind === 'bed' && run.doorOpenOn(on.place, on.index)))
    return null;
  if (!opts.stuck && map.blocked(nx, ny, r)) return null;
  // A BODY ALREADY AGAINST THE METAL MAY MOVE, anywhere its middle stays
  // out of the car. The flank is measured a body's radius out, so a walker
  // rubbing along a standing train, or on the lip as one passes, was inside
  // it by a hair and every step was refused: frozen until the train had
  // gone, and "crushed" on the platform (probe run2d after the walker got
  // its full pace back, 2026-09-25). Entering is still refused at the
  // radius; only escaping and sliding are let through.
  if ((opts.solidMetal ?? true) && metalAt(run, nx, ny, opts.inMetal ? 0 : r, from?.place.id).hit)
    return null;
  return on;
}

/**
 * Two bores that are one tunnel HERE. Measured over the whole network,
 * every bore overlap lies near a station both bores run into, and they are
 * of two kinds: the two run TOGETHER into it (the red and the green into
 * Slussen, 2–7° apart; the 17 and the 18/19 forking out of Gullmarsplan) or
 * they CROSS (the green to Hötorget over the red to Östermalmstorg, up to
 * 69°). Under the body's feet the angle between the two tells them apart:
 * within 15° they are one hall's approaches and a body may be in either
 * (probe run2d: a route out of Slussen enters whichever it meets first);
 * steeper, they are one above the other and it may not cross. A fork of
 * one colour on one storey is one tunnel whatever the angle.
 */
export function oneTunnelHere(a: Found, b: Found, x: number, y: number): boolean {
  const la = asLeg(a.place);
  const lb = asLeg(b.place);
  if (!la || !lb) return false;
  const shared = [la.cor.a, la.cor.b].filter((st) => st === lb.cor.a || st === lb.cor.b);
  if (shared.length === 0) return false;
  const ca = corridorColours(la.cor);
  if ([...corridorColours(lb.cor)].some((col) => ca.has(col)))
    for (const st of shared) if (corridorLevelAt(la.cor, st) === corridorLevelAt(lb.cor, st)) return true;
  // OTHER COLOURS: one tunnel between the SAME two stations (the red and the
  // green from Gamla stan to Slussen), and otherwise only in the APPROACH
  // to the one station they share, where they leave one hall side by side
  // and a walk from the platform has to be able to enter either. The angle
  // alone used to decide it, and out of T-Centralen the green to Hötorget
  // and the red to Östermalmstorg lie side by side for ninety metres at 0°,
  // so a walker in one strolled into the other and came out on the wrong
  // line (from play 2026-09-25). Past the approach a bore is its own.
  if (shared.length === 2) return true;
  const sa = corridorProject(la.cor, x, y).s;
  for (const st of shared) {
    const fromMouth = st === la.cor.a ? sa - la.cor.s0 : la.cor.s1 - sa;
    if (fromMouth < MOUTH_ZONE) return true;
  }
  return false;
}
/** how far out of a shared station two bores of different colours are still one hall */
export const MOUTH_ZONE = C.M(35);

/** every train that could be standing on this point, from the journeys
 * themselves, the same source the picture draws from */
function metalAt(
  run: RunFacts,
  x: number,
  y: number,
  r: number,
  inside?: string,
): { hit: boolean; moving: boolean } {
  let hit = false;
  let moving = false;
  for (const jid of run.metalNear(x, y)) {
    const body = trainBody(jid, run.gameNow);
    if (!body) continue;
    const along = bodyAt(body, x, y, r);
    if (along === null) continue;
    // ...and not a train on another floor of this place: it is laid across
    // this one on the map, which has no up (src/world/metal.ts sameStorey)
    if (!run.sameStorey(jid, x, y, inside)) continue;
    // a DOORWAY is not a wall, walking through one is exactly how anyone
    // boards, but the rest of the flank still is (src/world/metal.ts)
    if (!run.metalSolidAt(jid, along, r)) continue;
    hit = true;
    if (Math.abs(body.speed) > C.TRAIN_CRUSH_MIN) moving = true;
  }
  return { hit, moving };
}

/**
 * One step across the map, held by the floor and by the metal.
 *
 * A body that cannot go where it is pointed tries each axis alone before
 * giving up, so walking into a wall at an angle slides along it instead of
 * stopping dead. On a curved platform edge or a bending tunnel wall that is
 * the difference between following the world and being stuck on it.
 */
export function stepBody(
  run: RunFacts,
  map: Chunks,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  solidMetal: boolean,
  airborne = false,
  /**
   * THE WAY IT TURNED LAST TICK. A body is stateless here, so the side it
   * went round an obstacle was decided afresh every step, and a mob a
   * column's width from you, with the column dead ahead, turned left, then
   * right, then left: 1.4 px each way, for ever, never closing to the bite
   * (measured 2026-09-19: a vätte beside the player held at 1.9 m for four
   * seconds). A body that has started round one side keeps to it.
   */
  prefer: 1 | -1 | 0 = 0,
  /** the place the body is in, and the bore it means to enter (chunks.ts at) */
  want: { inside?: string; place?: string } = {},
): Step {
  const from = map.at(x, y, want.inside, want.place);
  // A BODY ALREADY INSIDE SOMETHING MUST BE ABLE TO GET OUT. Furniture can
  // close round one, a bench put down where it stands, a train stopping over
  // it, and a body that may not enter what it is already in cannot move at
  // all, which looks exactly like a world that will not let you walk.
  const stuck = map.blocked(x, y, r);
  const inMetal = solidMetal && metalAt(run, x, y, r).hit;
  const ok = (nx: number, ny: number) =>
    stepOk(run, map, from, nx, ny, r, { airborne, stuck, solidMetal, inMetal, wantPlace: want.place });
  let to = { x: x + dx, y: y + dy };
  let on = ok(to.x, to.y);
  let turned: 1 | -1 | 0 = 0;
  // SLIDE ALONG WHATEVER IS THERE. Trying world x and then world y is only a
  // slide if the world is axis-aligned, and none of this one is: a platform
  // stands at its own bearing and a tunnel wall bends. Turning the step
  // instead, a little, then more, slides along a wall at any angle, which
  // is most of them. Without it a body walking off a platform end at a
  // bearing simply stopped: the along-the-platform part of its step was never
  // tried on its own.
  if (!on) {
    const len = dist(dx, dy);
    const a0 = datan2(dy, dx);
    // ROUND THE SIDE THAT IS ACTUALLY FREE. Which way to turn is not a rule
    // to be picked once: sweeping one side first walks a body into the back
    // of a corner and holds it there, and taking whichever equal turn comes
    // first flips sides every tick at a bench's end and walks on the spot.
    // Turn AWAY from the thing in the way, and the choice is neither
    // arbitrary nor fixed, it is about the obstacle.
    //
    // ...and when it is DEAD AHEAD the two sides are exactly as good, so the
    // choice must not come from anything that changes as the body inches
    // about. It comes from the obstacle, which does not move: the same bench
    // is always gone round the same way, and the body commits instead of
    // dithering at its corner.
    const blocker = map.blockerMid(x + dx, y + dy, r);
    let away: 1 | -1 = 1;
    if (prefer !== 0) away = prefer;
    else if (blocker) {
      const cross = dx * (blocker.y - y) - dy * (blocker.x - x);
      const scale = dist(dx, dy) * dist(blocker.x - x, blocker.y - y);
      away =
        Math.abs(cross) > scale * 0.25
          ? cross > 0
            ? -1
            : 1
          : ((Math.floor(blocker.x) + Math.floor(blocker.y)) & 1) === 0
            ? 1
            : -1;
    }
    // A SIDE ALREADY TAKEN IS TRIED AT EVERY ANGLE before the other side at
    // any: with the sides interleaved per angle, a body going round the left
    // found the right free at the shallowest turn and went back (the dither
    // above, with the preference in place)
    const order: (readonly [number, 1 | -1])[] = [];
    if (prefer !== 0) {
      for (const turn of TURNS) order.push([turn, prefer]);
      for (const turn of TURNS) order.push([turn, -prefer as 1 | -1]);
    } else {
      for (const turn of TURNS) order.push([turn, away], [turn, -away as 1 | -1]);
    }
    for (const [turn, sign] of order) {
      const a = a0 + turn * sign;
      const q = { x: x + dcos(a) * len, y: y + dsin(a) * len };
      const at = ok(q.x, q.y);
      if (!at) continue;
      to = q;
      on = at;
      turned = sign;
      break;
    }
  }
  if (!on) {
    to = { x, y };
    on = map.at(x, y, want.inside, want.place);
  }
  // ...and on a platform a train is only ON you if your middle is in it:
  // the lip is a place to stand while one passes (the crush is for the bed)
  const metal = metalAt(run, to.x, to.y, on?.kind === 'platform' ? 0 : r);
  return { x: to.x, y: to.y, on, crushed: metal.hit && metal.moving, inMetal: metal.hit, turn: turned };
}
