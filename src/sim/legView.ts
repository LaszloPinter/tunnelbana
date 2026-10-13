import * as C from '../config.ts';
import { ANCHOR_X, ANCHOR_Y } from '../core/worldNet.ts';
import type { Corridor } from '../core/corridor.ts';
import { corridorMouth, unrollCorridor } from '../core/tube.ts';
import { corridorLateral, linePathOf, type CorridorPiece, type PathPiece } from '../core/linePath.ts';
import { journeyById, journeysOfServiceNear, type Journey } from '../core/fleet.ts';
import { journeyS, ownsMetalAt } from '../core/journeyMotion.ts';
import { Train } from '../core/train.ts';
import { bodyS, noseOffset } from '../core/corridorTraffic.ts';
import { journeyBandAt } from './journeyBand.ts';
import type { Place } from './place.ts';

/**
 * THE VIEW OF THE WORLD FROM ONE STATION. The world is one plane; the screen
 * shows one chart of it at a time: a station's own local axes, with each
 * corridor off its ends drawn UNROLLED, arc length keeps its exact meaning,
 * the curve is straightened for display. Everything that maps a world fact
 * into that chart lives here, so the walker, the trains and the tunnel art
 * are all one arithmetic and cannot drift apart.
 *
 * Pure: no Phaser, no randomness, so a probe can check it headless.
 */

/** the local x of the platform end a corridor joins at `st` */
export function mouthXOf(c: Corridor, st: Place): number {
  return corridorMouth(c, st.name, st.levelIndex).e > 0 ? st.platformX1 : st.platformX0;
}

/** corridor (s, t) in `st`'s local axes, `st` being one of its two ends */
export function unroll(c: Corridor, st: Place, s: number, t: number): { x: number; y: number } {
  return unrollCorridor(c, st.name, mouthXOf(c, st), s, t, st.levelIndex);
}

// ---- a journey in the local view: the ONE train→picture mapping ----

interface LocalPath {
  /** the pieces this view can show, by index: k-1, k, k+1 around the station piece */
  pieces: PathPiece[];
  /** the station piece's index in the path */
  k: number;
  stopS: number;
  /** local travel direction across this station */
  dlx: 1 | -1;
}

function localPathOf(st: Place, jid: string): LocalPath | null {
  const j = journeyById(jid);
  if (!j) return null;
  const path = linePathOf(j.service.id, j.dir);
  const stopIdx = j.stops.findIndex((s) => s.station === st.name);
  if (!path || stopIdx < 0) return null;
  const k = 1 + 2 * stopIdx;
  const sp = path.pieces[k];
  if (sp.kind !== 'station') return null;
  return { pieces: path.pieces, k, stopS: path.stopS[stopIdx], dlx: sp.dlx };
}

/** local x of a point at path arc S, on a piece this view can show */
function localXOnPiece(st: Place, lp: LocalPath, idx: number, S: number): number | null {
  const piece = lp.pieces[idx];
  if (!piece) return null;
  const d = S - piece.s0;
  if (d < 0 || d > piece.len) return null;
  if (piece.kind !== 'corridor') return piece.lx0 + piece.dlx * d;
  const sC = piece.sA + (piece.sB - piece.sA) * (piece.len > 0 ? d / piece.len : 0);
  return unroll(piece.cor, st, sC, 0).x;
}

/** is this train's BODY across the station's own platform? These two decide
 * WHICH PLACE PAINTS IT, so they ask about the metal, not the schedule's arc,
 * the bore owns by the body's centre (core noseOffset) and a short train
 * was otherwise claimed by both at once. */
export function onStationPiece(st: Place, jid: string, S: number): boolean {
  const lp = localPathOf(st, jid);
  return !!lp && localXOnPiece(st, lp, lp.k, bodyS(jid, S)) !== null;
}

export function corridorPieceAt(st: Place, jid: string, S: number): CorridorPiece | null {
  const lp = localPathOf(st, jid);
  if (!lp) return null;
  for (const idx of [lp.k - 1, lp.k + 1]) {
    const p = lp.pieces[idx];
    if (p?.kind === 'corridor' && localXOnPiece(st, lp, idx, bodyS(jid, S)) !== null) return p;
  }
  return null;
}

/** which kind of piece of this station's chart path arc S is on, its
 * platform, a siding off it, or one of the two corridors, or null if none */
export function pieceKindAt(st: Place, jid: string, S: number): PathPiece['kind'] | null {
  const lp = localPathOf(st, jid);
  if (!lp) return null;
  for (const idx of [lp.k, lp.k - 1, lp.k + 1]) {
    if (localXOnPiece(st, lp, idx, S) !== null) return lp.pieces[idx].kind;
  }
  return null;
}

/** is path arc S on a piece this station's chart shows, its own platform,
 * a siding off it, or one of the two corridors? */
export function onLocalStretch(st: Place, jid: string, S: number): boolean {
  const lp = localPathOf(st, jid);
  if (!lp) return false;
  return [lp.k, lp.k - 1, lp.k + 1].some((idx) => localXOnPiece(st, lp, idx, S) !== null);
}

/**
 * The train's CENTRE in `st`'s local x at path arc `S`: exact on the station
 * piece and the corridors and sidings off it; a train further away than
 * that is placed by straight extrapolation, where it is far off the chart
 * anyway.
 */
export function journeyLocalX(st: Place, jid: string, S: number): { x: number; dlx: 1 | -1 } | null {
  const lp = localPathOf(st, jid);
  if (!lp) return null;
  for (const idx of [lp.k, lp.k - 1, lp.k + 1]) {
    const x = localXOnPiece(st, lp, idx, S);
    if (x !== null) return { x, dlx: lp.dlx };
  }
  return { x: ANCHOR_X + lp.dlx * (S - lp.stopS), dlx: lp.dlx };
}

/** where a train's LEFT edge sits in local x for a journey at arc S: a short
 * train noses up to the same mark a full one does */
export function trainLeftX(
  st: Place,
  jid: string,
  S: number,
  length: number,
): { x: number; dlx: 1 | -1 } | null {
  const c = journeyLocalX(st, jid, S);
  if (!c) return null;
  // the nose-to-nose rule, in local x: forward is dlx (core noseOffset)
  const centre = c.x + c.dlx * noseOffset(length);
  return { x: centre - length / 2, dlx: c.dlx };
}

/** The drawn local y of a journey's TRACK at local x: its band alongside the
 * platform, and beyond either mouth the corridor's own lateral, swinging to
 * the bore gauge exactly as the traffic does (the same `corridorLateral` the
 * walker is crushed by). `bandY` is the fallback where no journey is known. */
export function trackLocalY(st: Place, jid: string | null, x: number, bandY: number): number {
  if (x >= st.platformX0 && x <= st.platformX1) return bandY;
  if (!jid) return bandY;
  const lp = localPathOf(st, jid);
  if (!lp) return bandY;
  const e: 1 | -1 = x > st.platformX1 ? 1 : -1;
  const mouthX = e > 0 ? st.platformX1 : st.platformX0;
  // WHICH PIECE LIES OFF THIS END is a question about the geometry, not
  // about the journey's heading: ask each adjoining corridor which mouth of
  // this platform it joins. Choosing by heading picked the corridor at the
  // OTHER end wherever a line reverses, and the lateral was then computed
  // in that corridor's frame, which drew the train several metres off,
  // through the tunnel wall (from play 2026-09-05).
  const after = lp.pieces[lp.k + 1];
  const before = lp.pieces[lp.k - 1];
  const endOf = (pc: PathPiece | undefined): 0 | 1 | -1 =>
    pc && pc.kind === 'corridor' ? corridorMouth(pc.cor, st.name, st.levelIndex).e : 0;
  let leaving = lp.dlx === e;
  let piece = leaving ? after : before;
  if (endOf(after) === e) {
    piece = after;
    leaving = true;
  } else if (endOf(before) === e) {
    piece = before;
    leaving = false;
  }
  if (!piece) return bandY;
  const dist = Math.abs(x - mouthX);
  const dTravel = Math.max(0, Math.min(piece.len, leaving ? dist : piece.len - dist));
  if (piece.kind === 'corridor') {
    // the train blends onto the band it actually stands at here, at a
    // terminus the sim alternates the arrival track, and the line path's
    // one band per direction would otherwise draw it swinging to the other
    const m = corridorMouth(piece.cor, st.name, st.levelIndex);
    const tHere = (bandY - m.y) * m.sign;
    const own = leaving ? { ...piece, tIn: tHere } : { ...piece, tOut: tHere };
    return m.y + m.sign * corridorLateral(own, dTravel);
  }
  if (piece.kind !== 'stub') return bandY;
  // a siding: the lateral blends to the rest point's
  const f = piece.len > 0 ? dTravel / piece.len : 0;
  return piece.ly0 + (piece.lyB - piece.ly0) * f;
}

/** the drawn local y of rail `ti`'s track at local x */
export function railTrackY(st: Place, ti: number, x: number): number {
  const rail = st.rails[ti];
  if (!rail) return ANCHOR_Y;
  return trackLocalY(st, rail.journey ?? null, x, rail.train.centerY);
}

/**
 * The drawn local y of something riding rail `ti`'s train at local x, a
 * shot, a coin, a passenger, given its sim y (the band's y plus its seat
 * offset). Out on a leg the train swings to the bore's lateral, and what is
 * aboard must swing with it: drawn on the band's y it sat a track-width
 * below the car (from play 2026-09-03: "my own shots a lot lower than me").
 */
export function aboardLocalY(st: Place, ti: number, x: number, y: number): number {
  const rail = st.rails[ti];
  if (!rail) return y;
  return railTrackY(st, ti, x) + (y - rail.train.centerY);
}

/** the DRAWN y of a point: on the ground the curve alone; riding rail
 * `ti`, the car's track wherever it has swung to */
export function drawYAt(st: Place, x: number, y: number, ti = -1): number {
  return st.worldY(x, ti >= 0 ? aboardLocalY(st, ti, x, y) : y);
}

/** the train's local x span reaches the view: within a leg or two of the platform */
const VIEW_REACH = C.M(1700);

/**
 * Every journey whose train belongs in this station's chart right now: it
 * owns its metal, and its centre is on the station piece, a siding, or one
 * of the two corridors. Rails' own journeys are among these by construction,
 * a train is drawn ONCE, keyed by journey, wherever it is.
 */
export function visibleJourneys(
  st: Place,
  now: number,
  stationOnly = false,
): { jid: string; S: number; speed: number }[] {
  const out: { jid: string; S: number; speed: number }[] = [];
  const seen = new Set<string>();
  const services = new Set(st.rails.flatMap((r) => r.options.map((o) => o.service)));
  const held = new Set(
    st.rails
      .filter((r) => r.train.active())
      .map((r) => r.journey)
      .filter((j): j is string => !!j),
  );
  /** a rail's own body already occupies this stretch of this band: the sim
   * realises one body per rail, and a second train over it is a schedule
   * conflict the picture must not paint (the ghost trains) */
  const occupied = (band: number, x0: number, x1: number) =>
    st.rails.some(
      (r) =>
        r.journey !== null &&
        r.journey !== undefined &&
        r.train.active() &&
        Math.abs((r.bandTop + r.bandBottom) / 2 - band) < 0.5 &&
        r.train.x < x1 &&
        r.train.x + r.train.length > x0,
    );
  // A JOURNEY A RAIL IS HOLDING IS ALWAYS A CANDIDATE. The near-window asks
  // the timetable who is due here, and it answers about the SCHEDULE, so a
  // body that is running late, or one resting in the siding long after it
  // terminated, drops out of the list while the sim is still driving it. It
  // is the train under the rider's feet that then goes out (from play
  // 2026-09-06: "my train temporarily became invisible under me").
  const candidates: Journey[] = [];
  for (const jid of held) {
    const j = journeyById(jid);
    if (j) candidates.push(j);
  }
  for (const svc of services) candidates.push(...journeysOfServiceNear(svc, st.name, now, C.HEADWAY_MS * 2));
  for (const j of candidates) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    // ...and metal a rail holds is this station's to draw, whatever the
    // turnaround bookkeeping says about the journey that owns it next
    if (!held.has(j.id) && !ownsMetalAt(j.id, now)) continue;
    const js = journeyS(j.id, now);
    if (!js || !onLocalStretch(st, j.id, js.S)) continue;
    if (stationOnly && !onStationPiece(st, j.id, js.S)) continue;
    const x = journeyLocalX(st, j.id, js.S)!.x;
    if (Math.abs(x - ANCHOR_X) > VIEW_REACH) continue;
    // on THIS storey's own track, or not shown here at all
    const band = journeyBandAt(st, j.id);
    if (!band) continue;
    // ...and a body standing in a SIDING is on its own track (linePath
    // sidingY), so it is never the second train on a rail's metal: this
    // guard used to hide it until the rail let go, and then it appeared
    // (from play 2026-09-05)
    if (!held.has(j.id) && pieceKindAt(st, j.id, js.S) !== 'stub') {
      const bandY = (band.bandTop + band.bandBottom) / 2;
      if (occupied(bandY, x - Train.LENGTH / 2, x + Train.LENGTH / 2)) continue;
    }
    out.push({ jid: j.id, S: js.S, speed: js.speed });
  }
  return out;
}

export { journeyBandAt } from './journeyBand.ts';
