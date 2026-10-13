import * as C from '../config.ts';
import { SERVICES } from './network.ts';
import { datan2, dist } from '../sim/det.ts';
import { ANCHOR_X, ANCHOR_Y, toWorld, type WFrame } from './worldNet.ts';
import { corridorPos, type Corridor } from './corridor.ts';
import { linePathOf, pathPos } from './linePath.ts';
import { isShortTrain, journeyById } from './fleet.ts';
import { journeyS } from './journeyMotion.ts';

/**
 * THE ONE WORLD, IN WORLD COORDINATES, the single surface the renderer draws
 * from (the render rebuild of 2026-09-03). Everything the sim holds in some
 * place's local frame is turned into one shared plane here: a point on a
 * platform, a point in a leg corridor, and, the piece that killed the old
 * renderer's "dummy train that became real", a TRAIN, as its cars bent along
 * the real line path, drawn exactly the same way whether it stands at a
 * platform or races down a leg. There is no second representation and nothing
 * is unrolled or rebased; the renderer is a camera over this plane.
 *
 * Pure and deterministic (trig from sim/det.ts, no randomness), so it can be
 * checked headless before a pixel is drawn (scripts/probe/worldview.ts).
 */

/** where a place id resolves on the plane */
export type PlaceRef = { kind: 'station'; frame: WFrame } | { kind: 'leg'; corridor: Corridor; from: string };

/**
 * A local point of a place, in world coordinates, with the world rotation to
 * add to a local-space facing angle so a rig points the right way.
 *
 * A station point is a rigid transform of the arena (`toWorld`). A corridor
 * point is its arc position `x` displaced by lateral `y` across the
 * centreline, the normal taken from the path tangent, the same arithmetic
 * the walker's collision uses, so picture and simulation cannot drift.
 */
export function pointWorld(ref: PlaceRef, x: number, y: number): { x: number; y: number; rot: number } {
  if (ref.kind === 'station') {
    const w = toWorld(ref.frame, x, y);
    return { x: w.x, y: w.y, rot: ref.frame.axis };
  }
  const c = ref.corridor;
  const q = corridorPos(c, x);
  const tl = Math.max(1e-9, Math.sqrt(q.tx * q.tx + q.ty * q.ty));
  const nx = -q.ty / tl;
  const ny = q.tx / tl;
  // local +x heads the way the walker entered (from `from`); the rig's facing
  // is composed against that
  const sign = ref.from === c.a ? 1 : -1;
  return { x: q.x + nx * y, y: q.y + ny * y, rot: datan2(q.ty * sign, q.tx * sign) };
}

export interface TrainCar {
  /** car centre, world */
  x: number;
  y: number;
  /** heading of the car's long axis, radians */
  angle: number;
  /** which end of the whole train this car is (0 = rear .. 1 = nose) */
  along: number;
}

export interface TrainRender {
  jid: string;
  serviceId: string;
  color: 'green' | 'red' | 'blue';
  short: boolean;
  cars: TrainCar[];
  /** the arc S of the train centre on its path, and speed, for effects */
  centreS: number;
  speed: number;
}

/**
 * A path resampled by TRUE WORLD DISTANCE. `pathPos`'s arc parameter is
 * piece-linear and stretches through crossovers, so cars spaced by it bunch
 * on curves; this samples the path finely, accumulates real distance, and
 * lets a train's cars be placed at even metre offsets that look even. Built
 * once per (service, dir) and cached.
 */
interface WorldSamples {
  wcum: number[];
  pts: { x: number; y: number; tx: number; ty: number }[];
  /** world distance at each path-arc sample, so a centre given as arc S maps in */
  arc: number[];
  total: number;
}
const sampleCache = new Map<string, WorldSamples>();

function samplesFor(serviceId: string, dir: 1 | -1): WorldSamples | null {
  const key = `${serviceId}:${dir}`;
  const hit = sampleCache.get(key);
  if (hit) return hit;
  const path = linePathOf(serviceId, dir);
  if (!path) return null;
  const STEP = C.M(3);
  const n = Math.max(2, Math.ceil(path.length / STEP));
  const pts: { x: number; y: number; tx: number; ty: number }[] = [];
  const wcum: number[] = [];
  const arc: number[] = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const s = (path.length * i) / n;
    const p = pathPos(path, s);
    if (i > 0) acc += dist(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    pts.push(p);
    wcum.push(acc);
    arc.push(s);
  }
  const out: WorldSamples = { wcum, pts, arc, total: acc };
  sampleCache.set(key, out);
  return out;
}

/** world distance along the path at path-arc S */
function arcToWorldDist(s: WorldSamples, arcS: number): number {
  let lo = 0;
  let hi = s.arc.length - 1;
  if (arcS <= 0) return arcS; // before the path: straight extrapolation
  if (arcS >= s.arc[hi]) return s.total + (arcS - s.arc[hi]);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.arc[mid] <= arcS) lo = mid;
    else hi = mid;
  }
  const f = (arcS - s.arc[lo]) / Math.max(1e-9, s.arc[hi] - s.arc[lo]);
  return s.wcum[lo] + (s.wcum[hi] - s.wcum[lo]) * f;
}

/** world position at world distance wd along the path (extrapolating past ends) */
function posAtWorld(s: WorldSamples, wd: number): { x: number; y: number; tx: number; ty: number } {
  if (wd <= 0) {
    const e = s.pts[0];
    return { x: e.x + e.tx * wd, y: e.y + e.ty * wd, tx: e.tx, ty: e.ty };
  }
  if (wd >= s.total) {
    const e = s.pts[s.pts.length - 1];
    const d = wd - s.total;
    return { x: e.x + e.tx * d, y: e.y + e.ty * d, tx: e.tx, ty: e.ty };
  }
  let lo = 0;
  let hi = s.wcum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.wcum[mid] <= wd) lo = mid;
    else hi = mid;
  }
  const seg = Math.max(1e-9, s.wcum[hi] - s.wcum[lo]);
  const f = (wd - s.wcum[lo]) / seg;
  const a = s.pts[lo];
  const b = s.pts[hi];
  const tx = (b.x - a.x) / seg;
  const ty = (b.y - a.y) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx, ty };
}

const carArcs = (cars: number, len: number, red: boolean): number[] => {
  // arc offset of each car centre from the train's rear (0), including the
  // external unit gaps a C20 has and the C30 does not
  const out: number[] = [];
  let off = 0;
  let inUnit = 0;
  for (let i = 0; i < cars; i++) {
    out.push(off + C.CAR_LENGTH / 2);
    off += C.CAR_LENGTH;
    inUnit += 1;
    if (!red && inUnit === C.CARS_PER_UNIT && i < cars - 1) {
      off += C.UNIT_GAP;
      inUnit = 0;
    }
  }
  void len;
  return out;
};

/**
 * A journey's train as world-space cars, bent along its line path. This is
 * the ONE train the renderer draws, at a platform, arriving, dwelling,
 * departing, or mid-leg, all the same call.
 */
export function trainRender(jid: string, now: number): TrainRender | null {
  const j = journeyById(jid);
  if (!j) return null;
  const s = samplesFor(j.service.id, j.dir);
  const js = journeyS(jid, now);
  if (!s || !js) return null;
  const color = j.service.color;
  const short = isShortTrain(jid);
  const cars = short ? 6 : 9;
  const red = color === 'red';
  const arcs = carArcs(cars, 0, red);
  const len = arcs[arcs.length - 1] + C.CAR_LENGTH / 2;
  // the train centre in WORLD distance, cars placed at even metre offsets so
  // they stay a car apart on curves, not by the path's stretchy arc param
  const centreW = arcToWorldDist(s, js.S);
  const rearW = centreW - len / 2;
  const out: TrainCar[] = [];
  for (let i = 0; i < cars; i++) {
    const p = posAtWorld(s, rearW + arcs[i]);
    out.push({ x: p.x, y: p.y, angle: datan2(p.ty, p.tx), along: len > 0 ? arcs[i] / len : 0 });
  }
  return { jid, serviceId: j.service.id, color, short, cars: out, centreS: js.S, speed: js.speed };
}

export { ANCHOR_X, ANCHOR_Y, SERVICES };
