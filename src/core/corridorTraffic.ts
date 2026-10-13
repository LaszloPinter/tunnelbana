/**
 * THE TRAFFIC IN A BORE: every train physically inside a corridor right now,
 * enumerated from the journeys themselves rather than from whichever body a
 * station happens to be showing. A walker in a tunnel is warned by, dodges
 * and is crushed by these, and the leg draws them (render/legView.ts), one
 * set of facts behind all of it.
 *
 * Split out of journeyMotion.ts, which answers where ONE journey is; this
 * answers who is in one PLACE.
 */
import * as C from '../config.ts';
import { SERVICES } from './network.ts';
import { journeysOfServiceNear, isShortTrain, journeyById, TURNBACK_MS, MIN_TRACK_GAP_MS } from './fleet.ts';
import { corridorLateral, linePathOf, type CorridorPiece, type LinePath } from './linePath.ts';
import type { Corridor } from './corridor.ts';
import { corridorKey } from './corridorId.ts';
import { Train } from './train.ts';
import { journeyS, ownsMetalAt } from './journeyMotion.ts';

export interface CorridorUse {
  serviceId: string;
  dir: 1 | -1;
  path: LinePath;
  piece: CorridorPiece;
}

const corridorUses = new Map<string, CorridorUse[]>();

/** every (service, direction) whose line path runs through this corridor,
 * with the exact piece, indexed once, off the paths themselves */
export function usesOf(c: Corridor): CorridorUse[] {
  const key = corridorKey(c);
  const hit = corridorUses.get(key);
  if (hit) return hit;
  const out: CorridorUse[] = [];
  for (const svc of SERVICES) {
    for (const dir of [1, -1] as const) {
      const path = linePathOf(svc.id, dir);
      if (!path) continue;
      for (const piece of path.pieces) {
        if (piece.kind === 'corridor' && piece.cor === c) out.push({ serviceId: svc.id, dir, path, piece });
      }
    }
  }
  corridorUses.set(key, out);
  return out;
}

/** a train's physical length for a journey (kort tåg run six cars) */
export function trainLenOf(jid: string, color: 'green' | 'red' | 'blue'): number {
  const cars = isShortTrain(jid) ? 6 : 9;
  // the red line's C30 is one continuous body; the others couple 3-car units
  const units = color === 'red' ? 1 : Math.ceil(cars / C.CARS_PER_UNIT);
  return cars * C.CAR_LENGTH + (units - 1) * C.UNIT_GAP;
}

export interface CorridorTrain {
  jid: string;
  serviceId: string;
  /** centre of the train, corridor arc coordinates */
  s: number;
  /** its track's lateral at that point */
  t: number;
  /**
   * ...and its track's lateral ANYWHERE along the bore. A car is 18 m and a
   * full train 140 m, while the tracks swing from the platform's own bands
   * to the bore gauge over 55 m, so a body drawn at the single lateral of
   * its centre has its far end metres off its own rails, and a train barely
   * into a tunnel is drawn standing on the platform (from play 2026-09-07).
   */
  latAt: (s: number) => number;
  /** px/s along +s (signed by its direction of travel) */
  vS: number;
  len: number;
}

/**
 * WHERE A SHORT TRAIN ACTUALLY IS. A journey's motion is one number, the
 * arc of a NOMINAL full-length train's centre, because the timetable does
 * not care how many cars turned up. A kort tåg is 93 m against a full
 * train's 140 m and it stops at the same mark, nose to nose, so its centre
 * sits this much further along its own direction of travel.
 *
 * Both pictures of a train have to apply this or they are not pictures of
 * the same train. The platform always did (sim/legView.ts trainLeftX); the
 * bore did not, so a kort tåg was drawn 23.55 m behind itself out in the
 * tunnel and jumped that far forward the instant the station took over
 * painting it, while the body you could be crushed by had been at the
 * forward position the whole time (from play 2026-09-07: "they roll in and
 * suddenly they are 40m ahead in a blink... I got damaged dashing onto a
 * moving train while visually there was nothing").
 */
export function noseOffset(len: number): number {
  return (Train.LENGTH - len) / 2;
}

/** WHERE THIS JOURNEY'S BODY IS, from the arc its schedule is at: the same
 * question `noseOffset` answers, asked by journey id. Every question about
 * WHICH PLACE a train is in has to go through this, or a short train is
 * owned by the platform and drawn by the bore at once. */
export function bodyS(jid: string, S: number): number {
  const j = journeyById(jid);
  if (!j) return S;
  return S + noseOffset(trainLenOf(jid, j.service.color));
}

/**
 * Every train physically inside this corridor right now, enumerated from
 * the journeys themselves, so a walker is chased by the ACTUAL traffic, not
 * by whichever body a station happens to be showing.
 */
export function corridorTrains(c: Corridor, now: number, color: 'green' | 'red' | 'blue'): CorridorTrain[] {
  const out: CorridorTrain[] = [];
  for (const use of usesOf(c)) {
    const svc = SERVICES.find((s) => s.id === use.serviceId)!;
    // a wide window: a train held at a signal short of a one-track terminus
    // (core/journeyMotion.ts) is in the corridor well past its timetable
    for (const j of journeysOfServiceNear(svc, c.a, now, C.HEADWAY_MS * 2 + TURNBACK_MS + MIN_TRACK_GAP_MS)) {
      if (j.dir !== use.dir) continue;
      // ONE TRAIN, ONE BODY, ONE COLLISION. A journey that does not own its
      // metal is not drawn (legView.visibleJourneys applies the same rule),
      // and being crushed by a train nobody can see is the worst death in
      // the game (from play 2026-09-05: "hit by trains while the train is
      // nowhere near")
      if (!ownsMetalAt(j.id, now)) continue;
      const js = journeyS(j.id, now);
      if (!js) continue;
      const len = trainLenOf(j.id, color);
      const d = js.S - use.piece.s0 + noseOffset(len);
      const margin = C.M(240);
      if (d < -margin || d > use.piece.len + margin) continue;
      const frac = use.piece.len > 0 ? d / use.piece.len : 0;
      const sC = use.piece.sA + (use.piece.sB - use.piece.sA) * frac;
      const tC = corridorLateral(use.piece, Math.max(0, Math.min(use.piece.len, d)));
      const dirS = use.piece.sB >= use.piece.sA ? 1 : -1;
      const piece = use.piece;
      const latAt = (sAny: number) =>
        corridorLateral(piece, Math.max(0, Math.min(piece.len, (sAny - piece.sA) * dirS)));
      out.push({
        jid: j.id,
        serviceId: use.serviceId,
        s: sC,
        t: tC,
        latAt,
        vS: js.speed * dirS,
        len,
      });
    }
  }
  return out;
}
