import * as C from '../config.ts';
import { linePathOf, pathPos, pathPosInto, type LinePath } from '../core/linePath.ts';

/** one curve sample, reused: a body is thirty of them, read and discarded */
const SAMPLE = { x: 0, y: 0, tx: 0, ty: 0 };
import { journeyById } from '../core/fleet.ts';
import { journeyS } from '../core/journeyMotion.ts';
import { noseOffset, trainLenOf } from '../core/corridorTraffic.ts';

/**
 * A TRAIN ON THE MAP.
 *
 * A journey's motion has always been one number, how far along its line it
 * is, and a line is a real path across Stockholm, straight through the
 * platforms and curving between them (core/linePath.ts). So a train's body
 * needs no frame either: it is a strip of the map, laid along the path it
 * runs on.
 *
 * That is the whole of what used to take a station's local x, a corridor's
 * arc, and a rule for turning one into the other at every mouth, the rule
 * that drew a car twelve metres from the car that could kill you, and drew a
 * short train twenty-three metres behind itself in a tunnel.
 */

/** how finely a car is cut along the path: same reasoning as the tunnel's
 * floor (src/world/bake.ts), on a body that is only 3.4 m wide, so a car's
 * length is plenty */
const STEP = C.M(4.5);

export interface Quad {
  x: [number, number, number, number];
  y: [number, number, number, number];
  /** the stretch of the train this piece covers, measured from its TAIL */
  a0: number;
  a1: number;
  /** its own box, for the reject */
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
}

/** a box round something, so a point plainly elsewhere costs four compares */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Body {
  jid: string;
  /** the quads of the metal, in order along the train */
  quads: Quad[];
  /** how fast it is going, px/s along its path, a standing train is safe */
  speed: number;
  /** the whole train's length, so a hit can be said as a place on it */
  len: number;
  /** THE BOX ROUND THE WHOLE TRAIN. Every body on the map asks every train
   * near it whether it is standing in it, for every direction it might step,
   * and nearly every answer is no, from a point hundreds of metres away.
   * Walking thirty quads and a hundred and twenty edges to find that out was
   * three fifths of the whole simulation (profiled 2026-09-11). */
  box: Box;
}

/**
 * ...AND BUILT ONCE A TICK. A body is thirty-odd quads off the line's curve,
 * and every walker asks for every train for every direction it might step:
 * seventeen candidate steps a body, fifteen bodies, ten trains near, some
 * seventy thousand samplings of a curve a frame, which is a quarter of a
 * second of simulation (measured in play 2026-09-11). The body cannot change
 * within a tick; `now` is the whole of what it depends on.
 */
const bodies = new Map<
  string,
  { at: number; mid: number; body: Body | null; doors?: { x: number; y: number }[] }
>();

/** the train's doorways as points on the map, remembered with its body,
 * so they are found once per train position, not once per mob per tick */
export function doorPoints(
  jid: string,
  now: number,
  doors: readonly { x0: number; x1: number }[],
): { x: number; y: number }[] | null {
  if (!trainBody(jid, now)) return null;
  const hit = bodies.get(jid)!;
  if (hit.doors) return hit.doors;
  const at = trainCars(jid, now);
  if (!at) return null;
  const out: { x: number; y: number }[] = [];
  for (const d of doors) {
    const p = at((d.x0 + d.x1) / 2);
    if (p) out.push({ x: p.x, y: p.y });
  }
  hit.doors = out;
  return out;
}

/**
 * ...AND ONLY WHEN THE TRAIN HAS MOVED: a body is a function of WHERE the
 * train is on its line, not of the clock, and a train dwelling at a platform
 * has the same body every tick. Rebuilt by the clock it was more than half of
 * a two-megabyte-a-tick churn whose collections were the frame-time spikes
 * (2026-09-16: GC pauses of 13–57 ms).
 */
export function trainBody(jid: string, now: number): Body | null {
  const hit = bodies.get(jid);
  if (hit && hit.at === now) return hit.body;
  const where = placeOf(jid, now);
  if (hit && where && hit.body && hit.mid === where.mid) {
    hit.at = now;
    hit.body.speed = where.speed;
    return hit.body;
  }
  // a train that has moved gets its quads REWRITTEN, not reallocated; nothing
  // keeps a Body from one tick to the next, so the numbers may change under it
  const body = where ? buildBody(jid, where, hit?.body ?? null) : null;
  if (bodies.size > 256) bodies.clear();
  bodies.set(jid, { at: now, mid: where?.mid ?? NaN, body });
  return body;
}

/** where a train's middle is on its line right now, and what it needs to
 * build its body from there */
function placeOf(
  jid: string,
  now: number,
): { path: LinePath; mid: number; len: number; speed: number } | null {
  const j = journeyById(jid);
  if (!j) return null;
  const path = linePathOf(j.service.id, j.dir);
  const js = journeyS(jid, now);
  if (!path || !js) return null;
  const len = trainLenOf(jid, j.service.color);
  // the schedule's arc is a nominal full-length train's centre; a short one
  // stops nose to nose with it (core/corridorTraffic.ts noseOffset)
  return { path, mid: js.S + noseOffset(len), len, speed: js.speed };
}

/** a quad's numbers written in place, or a fresh one when there is none to reuse */
function setQuad(
  q: Quad | undefined,
  alx: number,
  aly: number,
  blx: number,
  bly: number,
  brx: number,
  bry: number,
  arx: number,
  ary: number,
  a0: number,
  a1: number,
): Quad {
  const out: Quad = q ?? { x: [0, 0, 0, 0], y: [0, 0, 0, 0], a0: 0, a1: 0, bx0: 0, by0: 0, bx1: 0, by1: 0 };
  out.x[0] = alx;
  out.x[1] = blx;
  out.x[2] = brx;
  out.x[3] = arx;
  out.y[0] = aly;
  out.y[1] = bly;
  out.y[2] = bry;
  out.y[3] = ary;
  out.a0 = a0;
  out.a1 = a1;
  out.bx0 = Math.min(alx, blx, brx, arx);
  out.by0 = Math.min(aly, bly, bry, ary);
  out.bx1 = Math.max(alx, blx, brx, arx);
  out.by1 = Math.max(aly, bly, bry, ary);
  return out;
}

function buildBody(
  jid: string,
  where: { path: LinePath; mid: number; len: number; speed: number },
  reuse: Body | null,
): Body {
  const { path, mid, len } = where;
  const half = C.CAR_WIDTH / 2;
  // the same train's last body, rewritten in place: same length, same quads
  const old = reuse && reuse.len === len ? reuse : null;
  const quads: Body['quads'] = old ? old.quads : [];
  const tail = mid - len / 2;
  const p0 = pathPosInto(path, tail, SAMPLE);
  let alx = p0.x - p0.ty * half;
  let aly = p0.y + p0.tx * half;
  let arx = p0.x + p0.ty * half;
  let ary = p0.y - p0.tx * half;
  // THE LAST PIECE IS SHORT. A train is rarely a whole number of steps long,
  // so the piece that runs to the nose covers less than one, and naming its
  // start `to - STEP` puts it a step back down the train, which drags every
  // answer inside it up to a step and a half astern. At the lip of a doorway
  // that is the difference between a door and steel (probe doors2d, 2026-09-11).
  let from = 0;
  let n = 0;
  for (let s = STEP; ; s += STEP, n += 1) {
    const to = Math.min(s, len);
    const p = pathPosInto(path, tail + to, SAMPLE);
    const blx = p.x - p.ty * half;
    const bly = p.y + p.tx * half;
    const brx = p.x + p.ty * half;
    const bry = p.y - p.tx * half;
    const q = setQuad(quads[n], alx, aly, blx, bly, brx, bry, arx, ary, from, to);
    if (quads[n] !== q) quads.push(q);
    alx = blx;
    aly = bly;
    arx = brx;
    ary = bry;
    from = to;
    if (to >= len) break;
  }
  quads.length = n + 1;
  const box: Box = old ? old.box : { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  box.x0 = Infinity;
  box.y0 = Infinity;
  box.x1 = -Infinity;
  box.y1 = -Infinity;
  for (const q of quads) {
    if (q.bx0 < box.x0) box.x0 = q.bx0;
    if (q.by0 < box.y0) box.y0 = q.by0;
    if (q.bx1 > box.x1) box.x1 = q.bx1;
    if (q.by1 > box.y1) box.y1 = q.by1;
  }
  if (old) {
    old.speed = where.speed;
    return old;
  }
  return { jid, quads, speed: where.speed, len, box };
}

/** is this point inside that metal? */
export function inBody(b: Body, x: number, y: number, r = 0): boolean {
  return bodyAt(b, x, y, r) !== null;
}

/**
 * WHERE ON THE TRAIN a point is, how far from its tail, or null if it is
 * not on it at all.
 *
 * A train is not a plain wall: it is a wall with doorways in it, and which
 * one you are standing in front of is the difference between boarding and
 * bouncing off (from play 2026-09-10: "whole train wall is pass through when
 * the doors are supposed to be open"). Everything that decides that already
 * knows the train's own layout in train-relative terms (core/train.ts), so
 * all the map has to hand back is the place along.
 */
export function bodyAt(b: Body, x: number, y: number, r = 0): number | null {
  if (x < b.box.x0 - r || x > b.box.x1 + r || y < b.box.y0 - r || y > b.box.y1 + r) return null;
  let best: number | null = null;
  let over = Infinity;
  for (const q of b.quads) {
    if (x < q.bx0 - r || x > q.bx1 + r || y < q.by0 - r || y > q.by1 + r) continue;
    if (!inQuad(q, x, y, r)) continue;
    // a quad is a few metres of a gentle curve, so projecting onto its own
    // axis puts the point within a fraction of a doorway's width
    const mx0 = (q.x[0] + q.x[3]) / 2;
    const my0 = (q.y[0] + q.y[3]) / 2;
    const ex = (q.x[1] + q.x[2]) / 2 - mx0;
    const ey = (q.y[1] + q.y[2]) / 2 - my0;
    const l2 = ex * ex + ey * ey || 1;
    const t = ((x - mx0) * ex + (y - my0) * ey) / l2;
    // ...AND THE PIECE IT IS ACTUALLY ON. A point is tested against every
    // quad with a body's radius of slack, so one standing a hand's breadth
    // past a seam answers to the piece BEFORE it too, and taking that one's
    // answer put the point up to half a metre back down the train, which at
    // the lip of a doorway is the difference between a door and steel
    // (probe doors2d: four such places on every train).
    const past = t < 0 ? -t : t > 1 ? t - 1 : 0;
    if (past >= over) continue;
    over = past;
    best = q.a0 + (q.a1 - q.a0) * Math.max(0, Math.min(1, t));
    if (past === 0) break;
  }
  return best;
}

/**
 * Is the point inside the quad, with `r` of slack, OUTWARD when positive,
 * INWARD when negative. A body is inside a car when it is at least half its
 * own width in from the flank, which is what boarding asks with a negative
 * `r`. The test used to be "on the same side of every edge, give or take r",
 * and give-or-take has no inward reading: with r negative it accepted almost
 * nothing, and what it did accept was a hand's breadth OUTSIDE the far wall.
 * So a walker was seated just past the car's side and the very next tick
 * read that seat as having stepped off, boarded and off again in one frame
 * (probe ride2d, 8 of 8 "never carried", 2026-09-14). Measured against the
 * quad's own winding instead, inside means the same sign at every edge and
 * the slack means what it says.
 */
function inQuad(q: Quad, x: number, y: number, r: number): boolean {
  // the quad's winding, so an inside point measures positive at every edge
  let twice = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3;
    twice += q.x[i] * q.y[j] - q.x[j] * q.y[i];
  }
  const wind = twice < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) & 3;
    const ex = q.x[j] - q.x[i];
    const ey = q.y[j] - q.y[i];
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    const d = (wind * (ex * (y - q.y[i]) - ey * (x - q.x[i]))) / len;
    if (d < -r) return false;
  }
  return true;
}

/**
 * A TRAIN'S OWN LENGTH, as points on the map: give it a distance from the
 * train's tail and it hands back where that is and which way the line faces
 * there. What a car needs to stand somewhere.
 */
export function trainCars(
  jid: string,
  now: number,
): ((along: number) => { x: number; y: number; tx: number; ty: number } | null) | null {
  const seat = seatArc(jid, now, 0);
  if (!seat) return null;
  return (along: number) => {
    const s = seat.mid - seat.len / 2 + along;
    const p = pathPos(seat.path, s);
    return { x: p.x, y: p.y, tx: p.tx, ty: p.ty };
  };
}

/**
 * WHERE THIS TRAIN'S METAL LIES ALONG ITS LINE: the arc of a point so far
 * from its tail, and how long the train is. Everything about a train, its
 * body, its cars, the seats in them, is measured from here.
 */
export function seatArc(jid: string, now: number, rx: number) {
  const j = journeyById(jid);
  if (!j) return null;
  const path = linePathOf(j.service.id, j.dir);
  const js = journeyS(jid, now);
  if (!path || !js) return null;
  const len = trainLenOf(jid, j.service.color);
  const mid = js.S + noseOffset(len);
  // MEASURED FROM THE TAIL, ALWAYS. A line path runs the way the train does,
  // so its arc only ever increases with travel and the tail is always the low
  // end. Taking the end from the train's SPEED instead, which is what the
  // drawn body's "left" depends on, flips the whole seat end for end the
  // moment a train changes direction or stands still, and a rider is thrown
  // the length of the train (1,491 ticks of a ride spent outside the metal).
  const s = mid - len / 2 + rx;
  return { path, s, dlx: 1 as const, mid, len };
}
