import * as C from '../config.ts';
import { terminusTracks } from './timetable.ts';
import { evictOldest, headwayOf, journeyById, journeyId, journeyOf, MIN_TRACK_GAP_MS } from './fleet.ts';
import { linePathOf, pathPos, type LinePath } from './linePath.ts';

/**
 * WHERE EVERY TRAIN IS: a journey's motion along its line path, and the
 * turnaround that chains journeys into one physical train (§18, demanded
 * outright 2026-09-02). Pure arithmetic on (schedule, path); nothing is
 * simulated until something looks at it, and nothing is ever spawned, a
 * train that is not yet in service is standing in a siding, which is a
 * place, not an absence.
 */

// ---- kinematics: where a journey's train is, and how fast ----

interface RunSeg {
  t0: number;
  t1: number;
  S0: number;
  S1: number;
  /** trapezoid: accelerate at a to vp, cruise, brake at a, exact fit to (D, T) */
  vp: number;
  tA: number;
}

interface Motion {
  path: LinePath;
  segs: RunSeg[];
  /** at rest in the far siding from this time on */
  restAt: number;
  /** ...as the timetable has it, before any hold: what the turnback pairs on */
  restSched: number;
  /** emerges from the origin siding at this time (at rest before it) */
  emergeAt: number;
}

const motions = new Map<string, Motion>();

/** trapezoid profile time to cover D from rest to rest at accel a, cruise cap v */
export function timeFor(D: number): number {
  const a = C.TRAIN_ACCEL;
  const v = C.TRAIN_CRUISE;
  const dTri = (v * v) / a;
  if (D <= dTri) return 2 * Math.sqrt(D / a);
  return D / v + v / a;
}

/** fit a rest-to-rest trapezoid to distance D in time T (T ≥ timeFor-ish) */
function fitProfile(D: number, T: number): { vp: number; tA: number } {
  const a = C.TRAIN_ACCEL;
  // D = vp*T - vp^2/a  ->  vp^2 - aT vp + aD = 0
  const disc = a * a * T * T - 4 * a * D;
  const vp = disc >= 0 ? (a * T - Math.sqrt(disc)) / 2 : (a * T) / 2;
  return { vp, tA: vp / a };
}

/** a journey's stop times changed (core/fleet.ts shiftStops): its curve is stale */
export function forgetMotion(jid: string) {
  motions.delete(jid);
}

export function motionOf(jid: string): Motion | null {
  const hit = motions.get(jid);
  if (hit) return hit;
  const j = journeyById(jid);
  if (!j) return null;
  const path = linePathOf(j.service.id, j.dir);
  if (!path) return null;
  const segs: RunSeg[] = [];
  // emerge from the origin siding, arriving at stop 0 exactly on time
  const D0 = path.stopS[0];
  const T0 = timeFor(D0) * 1000;
  const emergeAt = j.stops[0].arriveAt - T0;
  {
    const { vp, tA } = fitProfile(D0, T0 / 1000);
    segs.push({ t0: emergeAt, t1: j.stops[0].arriveAt, S0: 0, S1: D0, vp, tA });
  }
  for (let i = 0; i + 1 < j.stops.length; i++) {
    const D = path.stopS[i + 1] - path.stopS[i];
    const T = (j.stops[i + 1].arriveAt - j.stops[i].departAt) / 1000;
    const { vp, tA } = fitProfile(D, Math.max(1, T));
    segs.push({
      t0: j.stops[i].departAt,
      t1: j.stops[i + 1].arriveAt,
      S0: path.stopS[i],
      S1: path.stopS[i + 1],
      vp,
      tA,
    });
  }
  // and away into the far siding
  const last = j.stops[j.stops.length - 1];
  const Dend = path.length - path.stopS[j.stops.length - 1];
  const Tend = timeFor(Dend) * 1000;
  {
    const { vp, tA } = fitProfile(Dend, Tend / 1000);
    segs.push({
      t0: last.departAt,
      t1: last.departAt + Tend,
      S0: path.stopS[j.stops.length - 1],
      S1: path.length,
      vp,
      tA,
    });
  }
  const restSched = last.departAt + Tend;
  /**
   * A ONE-TRACK TERMINUS HOLDS THE ARRIVAL OUTSIDE. The previous train in
   * turns and stands on the only platform until its own departure slot, and
   * the timetable's headway floor assumed that stand was TURNBACK long, but
   * the pairing lets it run to a headway, and then the next arrival ran in
   * nose to tail behind it (probe sametrack, Kungsträdgården, the day the
   * trains got faster). So the train waits at the stop before, and comes in
   * once the platform has cleared, as a real one does.
   */
  const n = j.stops.length;
  if (n >= 2 && terminusTracks(last.station, j.service.id) === 1) {
    const before = turnsInto(journeyId(j.service, j.dir, j.k - 1));
    const standing = before ? journeyById(before) : null;
    if (standing) {
      const clearAt = standing.stops[0].departAt + MIN_TRACK_GAP_MS;
      const hold = Math.max(0, clearAt - last.arriveAt);
      // ...AND IT WAITS IN THE TUNNEL, at a signal short of the platform,
      // not on the platform of the stop before. Held there it stood on the
      // track a following train of another service was timetabled onto:
      // a short 17 standing at Brommaplan with a 19 pulling in on top of it
      // (from play 2026-09-21). The run in is split at a waiting point a
      // train's length or two out, and the second half starts once the
      // platform has cleared.
      if (hold > 0) {
        const run = segs[segs.length - 2];
        const away = segs[segs.length - 1];
        const D = run.S1 - run.S0;
        const Lw = Math.min(D / 2, C.M(250));
        const Sw = run.S1 - Lw;
        const T1 = timeFor(D - Lw) * 1000;
        const T2 = timeFor(Lw) * 1000;
        const first: RunSeg = {
          t0: run.t0,
          t1: run.t0 + T1,
          S0: run.S0,
          S1: Sw,
          ...fitProfile(D - Lw, T1 / 1000),
        };
        const t2 = Math.max(first.t1, run.t1 + hold - T2);
        const second: RunSeg = { t0: t2, t1: t2 + T2, S0: Sw, S1: run.S1, ...fitProfile(Lw, T2 / 1000) };
        const late = second.t1 - run.t1;
        away.t0 += late;
        away.t1 += late;
        segs.splice(segs.length - 2, 1, first, second);
      }
    }
  }
  const m: Motion = { path, segs, restAt: segs[segs.length - 1].t1, restSched, emergeAt };
  if (motions.size > 512) evictOldest(motions);
  motions.set(jid, m);
  return m;
}

/** path S and speed of a journey at `now` (before emergence: at the origin
 * rest; after the far siding: at the far rest) */
export function journeyS(jid: string, now: number): { S: number; speed: number } | null {
  const m = motionOf(jid);
  if (!m) return null;
  if (now <= m.emergeAt) return { S: 0, speed: 0 };
  if (now >= m.restAt) return { S: m.path.length, speed: 0 };
  for (const seg of m.segs) {
    if (now > seg.t1) continue;
    if (now < seg.t0) return { S: seg.S0, speed: 0 }; // dwelling before this run
    const T = (seg.t1 - seg.t0) / 1000;
    const t = (now - seg.t0) / 1000;
    const a = C.TRAIN_ACCEL;
    const D = seg.S1 - seg.S0;
    let s: number;
    let v: number;
    if (t < seg.tA) {
      s = 0.5 * a * t * t;
      v = a * t;
    } else if (T - t < seg.tA) {
      const r = T - t;
      s = D - 0.5 * a * r * r;
      v = a * r;
    } else {
      s = 0.5 * a * seg.tA * seg.tA + seg.vp * (t - seg.tA);
      v = seg.vp;
    }
    return { S: seg.S0 + s, speed: v };
  }
  return { S: m.path.length, speed: 0 };
}

/** world position, heading and speed of a journey's train CENTRE at `now` */
export function journeyWorld(
  jid: string,
  now: number,
): { x: number; y: number; tx: number; ty: number; S: number; speed: number } | null {
  const m = motionOf(jid);
  const js = journeyS(jid, now);
  if (!m || !js) return null;
  const p = pathPos(m.path, js.S);
  return { ...p, S: js.S, speed: js.speed };
}

// ---- the turnaround: one train, both directions (§18, 2026-09-02) ----

/** the minimum a crew takes to change ends in the siding */
export const TURN_MIN_MS = 6_000;

/**
 * The journey this journey's train BECOMES: it runs into the far siding,
 * reverses, and emerges as the first opposite-direction departure whose
 * emergence is at least TURN_MIN after it came to rest. Pure arithmetic on
 * the two epochs, so every client agrees without a word.
 */
/**
 * The two clock-marks of a journey the TIMETABLE alone fixes: when it
 * emerges from its origin siding and when it would come to rest in the far
 * one. The turnback pairs on these, never on a motion, a motion may hold
 * before a busy terminus (motionOf), and a hold that asked the pairing which
 * asked the previous motion which asked the pairing was a stack overflow.
 */
const scheds = new Map<string, { emergeAt: number; restSched: number }>();
function schedOf(jid: string): { emergeAt: number; restSched: number } | null {
  const hit = scheds.get(jid);
  if (hit) return hit;
  const j = journeyById(jid);
  if (!j) return null;
  const path = linePathOf(j.service.id, j.dir);
  if (!path) return null;
  const last = j.stops[j.stops.length - 1];
  const out = {
    emergeAt: j.stops[0].arriveAt - timeFor(path.stopS[0]) * 1000,
    restSched: last.departAt + timeFor(path.length - path.stopS[j.stops.length - 1]) * 1000,
  };
  if (scheds.size > 2048) scheds.clear();
  scheds.set(jid, out);
  return out;
}

export function turnsInto(jid: string): string | null {
  const j = journeyById(jid);
  const m = schedOf(jid);
  if (!j || !m) return null;
  const back = -j.dir as 1 | -1;
  // find the smallest k' whose emergence is late enough
  const probe = journeyOf(j.service, back, 0);
  const m0 = schedOf(probe.id);
  if (!m0) return null;
  const k = Math.ceil((m.restSched + TURN_MIN_MS - m0.emergeAt) / headwayOf(j.service));
  return journeyId(j.service, back, k);
}

/** and the journey whose train THIS journey continues: the inverse pairing */
export function turnsFrom(jid: string): string | null {
  const j = journeyById(jid);
  const m = schedOf(jid);
  if (!j || !m) return null;
  const back = -j.dir as 1 | -1;
  const probe = journeyOf(j.service, back, 0);
  const m0 = schedOf(probe.id);
  if (!m0) return null;
  // the latest arrival k whose rest is early enough to make our emergence
  const restStep = headwayOf(j.service); // arrivals are as periodic as departures
  const k = Math.floor((m.emergeAt - TURN_MIN_MS - m0.restSched) / restStep);
  const candidate = journeyId(j.service, back, k);
  // pairing must be a bijection: accept only if that arrival turns into us
  return turnsInto(candidate) === jid ? candidate : null;
}

/**
 * Does this journey OWN its physical train at `now`? A train is one piece of
 * metal chained through many journeys: before this journey emerges from the
 * siding the metal still belongs to the arrival it continues, and once its
 * successor has emerged the metal is the successor's. Exactly one journey in
 * a chain owns the metal at any moment, which is what lets a station realise
 * each train ONCE, nothing is drawn twice, nothing is manufactured.
 */
export function ownsMetalAt(jid: string, now: number): boolean {
  const m = motionOf(jid);
  if (!m) return false;
  if (now < m.emergeAt && turnsFrom(jid) !== null) return false;
  if (now > m.restAt) {
    const nxt = turnsInto(jid);
    if (nxt) {
      const mn = motionOf(nxt);
      if (mn && now >= mn.emergeAt) return false;
    }
  }
  return true;
}

/** when this journey begins braking into its stop `stopIdx`, the moment its
 * remaining distance and speed match an arriving train's, and the natural
 * handover point for whoever is riding it */
export function brakeAtInto(jid: string, stopIdx: number): number | null {
  const m = motionOf(jid);
  const j = journeyById(jid);
  if (!m || !j || stopIdx <= 0 || stopIdx >= j.stops.length) return null;
  const arrive = j.stops[stopIdx].arriveAt;
  const seg = m.segs.find((s) => s.t1 === arrive);
  if (!seg) return null;
  return seg.t1 - seg.tA * 1000;
}

/** the piece of this journey's path that crosses its `stopIdx`-th station */
export function stationPieceOf(path: LinePath, stopIdx: number) {
  return path.pieces[1 + 2 * stopIdx];
}
