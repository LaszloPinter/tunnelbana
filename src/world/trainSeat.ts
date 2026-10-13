import * as C from '../config.ts';
import { pathPos } from '../core/linePath.ts';
import { isShortTrain, journeyById } from '../core/fleet.ts';
import { STOCK, Train } from '../core/train.ts';
import { pieceSpans } from '../core/trainPieces.ts';
import { seatArc, trainBody } from './trains2d.ts';

/**
 * WHERE A RIDER IS, the player, a vätte, a shot, a light, the trail a dash
 * leaves, said as a place on the map.
 *
 * Split from world/trains2d.ts, which answers where the METAL is. The two
 * are different questions about the same train and they are answered
 * differently: the metal is a strip laid along the line, and a seat is held
 * by the rigid CAR it is in. Keeping them in one file is how they came to
 * disagree, and a rider drawn on the line instead of on its car spills out of
 * the train wherever the track bends.
 */

/**
 * WHERE A RIDER IS, on the map.
 *
 * Riding was already expressed the right way: a seat is kept RELATIVE to the
 * car it is in, so far along the train from its left end, so far across it,
 * and the movement, the seats, the doors and the joints all work in those
 * terms. Only the last line ever needed the station: turning that relative
 * seat into a place in the world.
 *
 * On the map that line asks the line instead. A train is a body laid along
 * its own path, so a seat on it is an arc and an offset from the centreline,
 * and it means the same thing at a platform, in a tunnel, and at the moment
 * of crossing between them. Nothing hands over, so nothing can jump.
 */
export function aboardPoint(
  jid: string,
  rx: number,
  ry: number,
  now: number,
): { x: number; y: number } | null {
  const seat = seatArc(jid, now, rx);
  if (!seat) return null;
  /**
   * A SEAT IS IN A CAR, and a car is a rigid body held at its two ends
   * (render/mapMetal.ts). So a seat is placed the way the car is placed,
   * on the car's own chord, and not on the curve the chord spans.
   *
   * They are not the same line: on the tightest of this network's bends the
   * curve stands a metre and a half off the chord at the middle of a car.
   * Putting the car on one and everything aboard it on the other is what
   * spilled the riders, the tunnel light and a dash's trail out of the train
   * and onto the track beside it (from play 2026-09-11).
   */
  const span = spanAt(jid, rx);
  const tail = seat.mid - seat.len / 2;
  const a = pathPos(seat.path, tail + span.x0);
  const b = pathPos(seat.path, tail + span.x1);
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el = Math.sqrt(ex * ex + ey * ey) || 1;
  const ux = ex / el;
  const uy = ey / el;
  const w = span.x1 - span.x0;
  // the piece is DRAWN its own length, centred on the chord's middle
  const along = (rx - span.x0 - w / 2) * seat.dlx;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // local +y is the path's normal turned by the train's own direction of
  // travel: a train running the other way has its left and its right the
  // other way round too
  const side = ry * seat.dlx;
  return { x: mx + ux * along - uy * side, y: my + uy * along + ux * side };
}

/**
 * THE CAR'S OWN SPEED UNDER A CAST: a bolt or a spit that leaves a seat on a
 * moving train leaves with the train's velocity, or it is left behind the
 * moment it exists. Null when the train is not on the map.
 */
export function seatDrift(jid: string, rx: number, now: number): { vx: number; vy: number } | null {
  const body = trainBody(jid, now);
  const head = seatHeading(jid, rx, now);
  if (!body || !head) return null;
  return { vx: head.tx * body.speed, vy: head.ty * body.speed };
}

/** the piece of the train a distance from its tail falls in */
function spanAt(jid: string, rx: number): { x0: number; x1: number } {
  const spans = spansOf(jid);
  for (const s of spans) if (rx >= s.x0 && rx <= s.x1) return s;
  return spans[rx < 0 ? 0 : spans.length - 1] ?? { x0: 0, x1: C.CAR_LENGTH };
}

const spanCache = new Map<string, { x0: number; x1: number }[]>();
const unitCache = new Map<string, { x0: number; x1: number }[]>();

/**
 * The SEALED BODIES of this journey's train: a C20 is three of them coupled
 * together and a C30 is one long corridor, which is the tactical difference
 * between the two (core/train.ts). Asked of the stock, not of a platform, so
 * it answers in a tunnel too, which is where riding is fought.
 */
export function unitsOf(jid: string): { x0: number; x1: number }[] {
  const hit = unitCache.get(jid);
  if (hit) return hit;
  const t = trainOf(jid);
  const units = t.bodies.map((b) => ({ x0: b.x0, x1: b.x1 }));
  if (unitCache.size > 256) unitCache.clear();
  unitCache.set(jid, units);
  return units;
}

function trainOf(jid: string): Train {
  const j = journeyById(jid);
  const stock = j?.service.color === 'red' ? STOCK.c30 : STOCK.c20;
  const t = new Train(0, 1, 1, stock);
  t.setCars(isShortTrain(jid) ? stock.shortCars : stock.fullCars);
  return t;
}

/** how this journey's train is cut into pieces, the ONE cut (core/train.ts) */
export function spansOf(jid: string): { x0: number; x1: number }[] {
  const hit = spanCache.get(jid);
  if (hit) return hit;
  const spans = pieceSpans(trainOf(jid)).map((s) => ({ x0: s.x0, x1: s.x1 }));
  if (spanCache.size > 256) spanCache.clear();
  spanCache.set(jid, spans);
  return spans;
}

/** which side a train's doors face, from the platform it is realised at,
 * in that STATION'S own chart, which is where a plan is written */
export function doorSideOf(
  run: {
    live: Set<string>;
    places: Map<string, { rails?: { journey?: string | null; train: { doorSide: 1 | -1 } }[] }>;
  },
  jid: string,
): 1 | -1 {
  for (const id of run.live) {
    const rails = run.places.get(id)?.rails;
    for (const rail of rails ?? []) if (rail.journey === jid) return rail.train.doorSide;
  }
  return 1;
}

/** where a seat on this rail's train is, on the map */
export function seatOnMap(
  st: { rails: { journey?: string | null }[] },
  frame: { ti: number; rx: number; ry: number; jid?: string },
  now: number,
): { x: number; y: number } | null {
  const jid = frame.jid ?? st.rails[frame.ti]?.journey;
  return jid ? aboardPoint(jid, frame.rx, frame.ry, now) : null;
}

/**
 * WHICH WAY THE TRAIN IS FACING at a seat, so a push on the stick can be
 * said in the car's terms. Inside a train "forward" is along the body and
 * "sideways" is across it, and on the map the body lies at whatever angle the
 * line does. Feeding screen directions straight in makes the controls turn
 * with the tunnel (from play 2026-09-10: "controls on the train are turned
 * all around").
 */
export function seatHeading(jid: string, rx: number, now: number): { tx: number; ty: number } | null {
  const seat = seatArc(jid, now, rx);
  if (!seat) return null;
  const p = pathPos(seat.path, seat.s);
  return { tx: p.tx, ty: p.ty };
}

/**
 * ...and the other way round: a point of the map, said as a seat. Used at the
 * moment of boarding, which is the only time anyone has to ask.
 */
export function seatAt(jid: string, now: number, x: number, y: number): { rx: number; ry: number } | null {
  const seat = seatArc(jid, now, 0);
  if (!seat) return null;
  // walk the body and take the nearest point on it: a train is a few hundred
  // metres of gentle curve, so a metre of sampling and one refinement is
  // exact to well under a body's width
  let best = seat.mid;
  let bestD = Infinity;
  const from = seat.mid - seat.len / 2;
  const to = seat.mid + seat.len / 2;
  for (let s = from; s <= to; s += C.M(1)) {
    const p = pathPos(seat.path, s);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  for (let s = best - C.M(1); s <= best + C.M(1); s += C.M(0.1)) {
    const p = pathPos(seat.path, s);
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  // ...AND THEN SAID IN THE CAR'S OWN TERMS. The search above walks the
  // LINE, which is not where the car is: a car is rigid and spans the chord
  // (aboardPoint above). Handing back a seat measured on one and read back on
  // the other puts a body a little off from the doorway it just stepped
  // through, by the whole sag of the bend, on the worst of them.
  const rough = seat.dlx > 0 ? best - from : to - best;
  const span = spanAt(jid, rough);
  const a = pathPos(seat.path, from + span.x0);
  const b = pathPos(seat.path, from + span.x1);
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el = Math.sqrt(ex * ex + ey * ey) || 1;
  const ux = ex / el;
  const uy = ey / el;
  const w = span.x1 - span.x0;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const along = (x - mx) * ux + (y - my) * uy;
  const across = -(x - mx) * uy + (y - my) * ux;
  return { rx: span.x0 + w / 2 + along * seat.dlx, ry: across * seat.dlx };
}
