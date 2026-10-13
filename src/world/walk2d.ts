import * as C from '../config.ts';
import { onPlatform } from './floor.ts';
import { Station } from '../sim/station.ts';
import { stepBody } from './body2d.ts';
import { asLeg, asStation } from '../sim/place.ts';
import { corridorOf, corridorProject } from '../core/corridor.ts';
import { bandOfService } from '../core/stationLayout.ts';
import { legIdOf } from '../sim/leg.ts';
import { arriveOnFoot } from '../sim/legWalk.ts';
import { stepTunnelAmbush, warnOfTraffic } from '../sim/tunnelEvents.ts';
import { inBody, trainBody } from './trains2d.ts';
import { seatAt } from './trainSeat.ts';
import { airborne, type Player } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';
import { dcos, dsin } from '../sim/det.ts';

/**
 * ONE WALKER'S TICK, ON THE MAP.
 *
 * This is what `stepWorld` and `stepLeg` become when there is one world: not
 * two functions and a crossing between them, but one. Which room you are in
 * is something you can ASK the ground (it decides whose rules apply, a
 * platform's trains, a tunnel's alcoves) rather than something your position
 * is expressed in.
 *
 * Arriving somewhere is therefore not an event that has to be arranged. You
 * walk, and at some point the ground under you belongs to a platform you were
 * not at before. That is the arrival.
 */
export function stepWalk2d(run: Run, p: Player, mvx: number, mvy: number, now: number): boolean {
  const map = run.map;
  const before = p.placeId;
  // A DASH IS A JUMP. Stepping down off a deck onto the tracks is refused to
  // a body on its feet, that is what stops you falling in, and allowed to
  // one in the air (body2d.ts mayGo). The map's walker never said whether it
  // was in the air, so the answer was always "on its feet": the platform edge
  // held against a dash, and the whole track bed, the crossing to the far
  // island and everything down there was unreachable (from play 2026-09-11:
  // "I cannot get down to the tracks even by dash").
  const wantLeg = routeLegFrom(run, before);
  const moved = stepBody(run, map, p.x, p.y, mvx, mvy, p.r, now >= p.noTrainHitUntil, airborne(p, now), 0, {
    inside: before,
    place: wantLeg,
  });
  // IN A BORE THE TUNNEL ANSWERS: the warning of what is coming, and the
  // ambush once you are deep enough in (sim/tunnelEvents.ts), asked by arc,
  // which on the map is the walker's point projected onto the curve
  const leg = moved.on?.kind === 'bore' ? asLeg(moved.on.place) : null;
  if (leg) {
    const was = corridorProject(leg.cor, p.x, p.y);
    const is = corridorProject(leg.cor, moved.x, moved.y);
    const shielded = leg.inRefuge(is.s, is.t, p.r);
    warnOfTraffic(run, leg, p, { s: is.s, t: is.t, ds: is.s - was.s, shielded }, now);
    if (!run.tutorial && stepTunnelAmbush(run, leg, p, is.s))
      run.showMsg('Something was already down here.', now, p);
  }
  // TUTORIALSTORG'S FENCE: a step that would leave the pen is not taken
  if (run.tutorial && run.tutorialPen && outsidePen(run, moved.x, moved.y)) return true;
  p.x = moved.x;
  p.y = moved.y;
  if (moved.crushed && now >= p.noTrainHitUntil) {
    run.die(p, 'Never stand on the tracks when a train is coming.');
    return p.alive;
  }
  // ...and if you have walked into a car with its doors open, you are on it
  if (boardHere(run, p, now)) return true;
  // THE DOORS SHUT ON YOU. Half in the doorway when they closed, a body was
  // left standing in a flank that had just become solid, and the moment the
  // train moved it was "crushed", "boarded a train and died as soon as it
  // started to move" (from play 2026-09-24). Nobody is cut in two by a
  // door: you are on the train if your middle is, and back on the platform
  // if it is not.
  if (moved.inMetal && !moved.crushed && p.frame.kind === 'world') {
    if (boardHere(run, p, now, true)) {
      run.showMsg('The doors closed on you. You are on.', now, p);
      return true;
    }
    const out = clearSpot(run, p.x, p.y, p.r, 'platform');
    p.x = out.x;
    p.y = out.y;
    run.showMsg('The doors closed on you. Back on the platform.', now, p);
  }
  // which room the ground belongs to now, staying in the one you are in
  // wherever two bores share it (src/world/chunks.ts at)
  const on = run.map.at(p.x, p.y, before, wantLeg);
  if (!on) return true;
  const to = on.place;
  if (to.id === before) return true;
  // the ground changed hands: that is all a place change is now
  p.placeId = to.id;
  if (p.id !== run.localId) return true;
  run.hereId = to.id;
  const st = asStation(to);
  if (!st || st.name === run.lastStationName) {
    run.host.railsChanged();
    run.host.dressStation();
    run.host.stationChanged('walk');
    return true;
  }
  run.lastStationName = st.name;
  run.host.railsChanged();
  run.host.dressStation();
  run.host.stationChanged('walk');
  arriveOnFoot(run, st, p, now);
  return false;
}

/**
 * SOMEWHERE A BODY COULD ACTUALLY BE. The middle of a deck is where the roof
 * columns are, so a body put down at the obvious point is put down inside
 * one, and then it cannot move at all, which reads exactly like a world
 * that will not let you walk.
 */
export function clearSpot(
  run: Run,
  x: number,
  y: number,
  r: number,
  want?: 'platform',
): { x: number; y: number } {
  const map = run.map;
  const good = (q: { x: number; y: number }) => {
    const on = map.at(q.x, q.y);
    return !!on && (!want || on.kind === want) && !map.blocked(q.x, q.y, r);
  };
  if (good({ x, y })) return { x, y };
  for (let ring = 1; ring <= 40; ring++) {
    const step = ring * C.M(0.5);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const q = { x: x + dcos(a) * step, y: y + dsin(a) * step };
      if (good(q)) return q;
    }
  }
  return { x, y };
}

/**
 * STEPPING INTO A CAR. On the map there is no gap between a platform and a
 * train to be handled specially: a body walks, and at some point it is inside
 * the metal. If a door is open where it is, it is aboard, a seat kept
 * relative to the car, which is how riding has always been expressed
 * (sim/ground.ts stepAboard).
 *
 * Only a train standing at a platform can be boarded, so the rail it is on is
 * where the doors, the seats and the joints are known.
 */
/** `shut`: the doors have closed on this body, it is on if its middle is
 * inside the car, whatever the door (walk2d.ts, the doorway rule) */
function boardHere(run: Run, p: Player, now: number, shut = false): boolean {
  if (now < p.noTrainHitUntil) return false;
  for (const id of run.live) {
    const st = asStation(run.places.get(id));
    if (!st) continue;
    for (let ti = 0; ti < st.rails.length; ti++) {
      const jid = st.rails[ti].journey;
      const t = st.rails[ti].train;
      // the cheap questions first: a shut door cannot be walked through, and
      // building a train's body to find that out is most of a tick's work
      if (!jid || !t.active() || (!t.doorsOpen && !shut)) continue;
      const body = trainBody(jid, run.gameNow);
      if (!body || !inBody(body, p.x, p.y, shut ? 0 : -p.r * 0.5)) continue;
      const seat = seatAt(jid, run.gameNow, p.x, p.y);
      if (!seat || (!shut && !t.passableAtRel(seat.rx, p.r))) continue;
      p.placeId = st.id;
      if (p.id === run.localId) run.hereId = st.id;
      p.frame = { kind: 'aboard', ti, rx: seat.rx, ry: seat.ry, jid };
      return true;
    }
  }
  return false;
}

/** past the ends of the tutorial's pen, in the platform's own along-x */
function outsidePen(run: Run, x: number, y: number): boolean {
  const pen = run.tutorialPen!;
  const st = asStation(run.places.get(Station.idOf(pen.station)));
  // only Tutorialstorg is fenced: at the far end of the ride you walk freely
  if (!st || run.hereId !== st.id) return false;
  const at = onPlatform(st, x, y);
  return !at || at.x < pen.x0 || at.x > pen.x1;
}

/**
 * THE BORE A WALKER MEANS: the one to their route's next stop, from the
 * station they are in. Where two bores leave a station together the ground
 * is both, and this is what decides which one they are in when they step
 * off the platform (chunks.ts at). Nothing when they are not in a station
 * or the route does not leave it.
 */
export function routeLegFrom(run: Run, placeId: string): string | undefined {
  const st = asStation(run.places.get(placeId));
  const leg = run.route[0];
  if (!st || !leg) return undefined;
  const order = leg.service.stations;
  const i = order.indexOf(st.name);
  const next = i >= 0 ? order[i + leg.dir] : undefined;
  if (!next) return undefined;
  const far = bandOfService(next, leg.service.id, leg.dir);
  const c = corridorOf(st.name, next, st.levelIndex, far?.levelIndex ?? 0);
  return c ? legIdOf(c) : undefined;
}

/** where a body stands, as a point on the map */
export function spawnAt(run: Run, p: Player, x0: number, y0: number) {
  const { x, y } = clearSpot(run, x0, y0, p.r, 'platform');
  p.x = x;
  p.y = y;
  const on = run.map.at(x, y);
  if (on) {
    p.placeId = on.place.id;
    if (p.id === run.localId) run.hereId = on.place.id;
  }
}

/** a walker's reach, for whatever wants one number */
export const BODY_R = C.M(0.55);
