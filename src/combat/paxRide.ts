import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { asStation } from '../sim/place.ts';
import { isOccupied } from '../sim/places.ts';
import type { Passenger } from '../sim/passenger.ts';
import {
  dealerAbout,
  DEALER_TRAIN,
  islandAtLocal,
  islandOf,
  railsOfIsland,
  spawnDealer,
  spawnGroup,
} from '../sim/paxSpawn.ts';
import type { Run } from '../sim/run.ts';
import { platformSide } from './paxAboard.ts';
import type { Station } from '../sim/station.ts';
import { fromPlatform } from '../world/floor.ts';
import { railTrainOf } from '../world/metal.ts';
import { journeyById } from '../core/fleet.ts';
import { aboardPoint } from '../world/trainSeat.ts';

/**
 * PASSENGERS AND THE TRAINS (DESIGN §20). Strangers exist where the party
 * can see them, and every group is here for something:
 *
 *   off a train   a train opening its doors where the party is may let a
 *                 group off, mostly on their way OUT (to an escalator, and
 *                 gone), some changing to another track (they go and wait)
 *   catch         wait beside their track; when ITS train opens they walk
 *                 to its doors together, sit, and ride away
 *   ridden away   once that train has left their platform and is out of
 *                 the party's sight (the whole network is live, so "gone
 *                 from the world" never happens)
 *
 * Every roll is the content stream of that train at that station, once
 * (run.paxNet.seen), so a seed always lets the same people off.
 */
export const ALIGHT_CHANCE = 0.7;
/** of the groups riding into a station, how many are getting off at it */
export const OFF_HERE = 0.4;
/** of those who get off, how many change trains rather than leave */
export const CHANGE_SHARE = 0.25;
/** how long anyone waits before giving up on a train and leaving */
export const PATIENCE_MS = 4 * 60_000;
const SEEN_KEEP = 200;

/**
 * each tick, at every station the party is in: who is ALREADY ON a train
 * as it comes in, seated, riding into the platform, and gets off when
 * its doors open (stepAboardPax)
 */
export function paxArrivals(run: Run, now: number) {
  if (run.tutorial) return;
  const seen = run.paxNet.seen;
  for (const id of run.live) {
    const st = asStation(run.places.get(id));
    if (!st || !isOccupied(run, st)) continue;
    st.rails.forEach((rail, ti) => {
      const jid = rail.journey;
      const t = rail.train;
      if (!jid || (t.phase !== 'arriving' && t.phase !== 'dwell') || t.bodies.length === 0) return;
      const key = `${jid}@${st.id}`;
      if (seen.includes(key)) return;
      seen.push(key);
      if (seen.length > SEEN_KEEP) seen.shift();
      const rng = run.contentRng(`paxoff:${key}`);
      if (rng() >= ALIGHT_CHANCE) return;
      // A TRAINFUL, not a delegation: one to three groups aboard, each in
      // a car of its own and each going somewhere of its own, only some of
      // them to here (from play 2026-10-11: "not everyone must get off")
      // the dealer, riding in, now and then: seated in a car, and as likely as
      // not to ride on, the bag is open for as long as the train is
      if (rng() < DEALER_TRAIN && !dealerAbout(run)) {
        const body = t.bodies[Math.floor(rng() * t.bodies.length)];
        const rx = body.x0 + C.M(1.5) + rng() * Math.max(0, body.x1 - body.x0 - C.M(3));
        const ry = (rng() - 0.5) * (C.CAR_WIDTH - C.M(1.4));
        const d = spawnDealer(run, st, { x: 0, y: 0 }, rng, now);
        d.plan = 'exit';
        d.mode = 'aboard';
        d.jid = jid;
        d.frame = { kind: 'aboard', ti, rx, ry, jid };
        d.seatRx = rx;
        d.seatRy = ry;
        d.stopsToGo = rng() < 0.5 ? 1 : 2 + Math.floor(rng() * 3);
        d.dest = destOf(jid, st.name, d.stopsToGo - 1);
        const at = aboardPoint(jid, rx, ry, now);
        if (at) {
          d.x = at.x;
          d.y = at.y;
        }
      }
      const groups = 1 + Math.floor(rng() * 3);
      for (let g = 0; g < groups; g++) {
        const body = t.bodies[Math.floor(rng() * t.bodies.length)];
        const lo = body.x0 + C.M(1.5);
        const hi = body.x1 - C.M(1.5);
        const along = lo + rng() * Math.max(0, hi - lo);
        const stops = rng() < OFF_HERE ? 1 : 2 + Math.floor(rng() * 3);
        const change = stops === 1 && rng() < CHANGE_SHARE;
        // a change of trains along the SAME island: nobody crosses the tracks
        const isl = st.platforms.findIndex((p) => p.railTop === ti || p.railBottom === ti);
        const others = railsOfIsland(st, isl).filter((x) => x !== ti);
        const to = change && others.length > 0 ? others[Math.floor(rng() * others.length)] : -1;
        const group = spawnGroup(run, st, rng, to >= 0 ? 'catch' : 'exit', () => ({ x: 0, y: 0 }), now, to);
        group.forEach((ps, i) => {
          const rx = Math.max(lo, Math.min(hi, along + (i - (group.length - 1) / 2) * C.M(0.9)));
          const ry = (rng() - 0.5) * (C.CAR_WIDTH - C.M(1.4));
          ps.mode = 'aboard';
          ps.jid = jid;
          ps.frame = { kind: 'aboard', ti, rx, ry, jid };
          ps.seatRx = rx;
          ps.seatRy = ry;
          ps.stopsToGo = stops;
          ps.dest = destOf(jid, st.name, stops - 1);
          const at = aboardPoint(jid, rx, ry, now);
          if (at) {
            ps.x = at.x;
            ps.y = at.y;
          }
        });
      }
    });
  }
}

/** the station `ahead` stops on from `from` on journey `jid`, where someone is going */
export function destOf(jid: string, from: string, ahead: number): string {
  const stops = journeyById(jid)?.stops ?? [];
  const i = stops.findIndex((s) => s.station === from);
  return (i >= 0 ? stops[Math.min(stops.length - 1, i + ahead)]?.station : undefined) ?? from;
}

/**
 * THEIR OWN TRACK'S TRAIN, standing with its doors open: the spot on the
 * platform right in front of its nearest DOORWAY, on the deck, a step from
 * the car, to walk to and board from. (Boarding from a spot two metres
 * back and a metre to one side put them in the car beside the door: they
 * walked through the wall, from play 2026-10-11.)
 */
export function trainToBoard(
  run: Run,
  ps: Passenger,
  now: number,
): { x: number; y: number; jid: string; rx: number; out: 1 | -1 } | null {
  const st = asStation(run.places.get(ps.placeId));
  const rail = st?.rails[ps.waitTi];
  const jid = rail?.journey;
  if (!st || !rail || !jid || rail.train.phase !== 'dwell' || !rail.train.doorsOpen) return null;
  // not their line: they let it go by
  if (ps.want && journeyById(jid)?.service.id !== ps.want) return null;
  let best: { x: number; y: number; jid: string; rx: number; out: 1 | -1 } | null = null;
  let bd = Infinity;
  for (const d of rail.train.doors) {
    const rx = (d.x0 + d.x1) / 2;
    const out = platformSide(run, st, jid, rx, now);
    // the first point out from the doorway that is deck
    let at: { x: number; y: number } | null = null;
    for (let k = 0; k <= 8 && !at; k++) {
      const p = aboardPoint(jid, rx, out * (C.CAR_WIDTH / 2 + ps.r + C.M(0.25) * k), now);
      if (p && run.map.at(p.x, p.y, st.id)?.kind === 'platform') at = p;
    }
    if (!at) continue;
    const dd = dist(at.x - ps.x, at.y - ps.y);
    if (dd < bd) {
      bd = dd;
      best = { ...at, jid, rx, out };
    }
  }
  return best;
}

/** in front of the doorway: through it, into the car, and on to a seat. True if they got on */
export function boardIfAtDoor(
  run: Run,
  ps: Passenger,
  door: { x: number; y: number; jid: string; rx: number; out: 1 | -1 },
) {
  if (dist(door.x - ps.x, door.y - ps.y) > C.M(0.7)) return false;
  // IN THROUGH THE DOORWAY, just inside it
  const rx = door.rx;
  const ry = door.out * (C.CAR_WIDTH / 2 - ps.r);
  ps.mode = 'aboard';
  ps.jid = door.jid;
  ps.frame = { kind: 'aboard', ti: ps.waitTi, rx, ry, jid: door.jid };
  // a seat further in, along the car and across it, inside THIS car
  const rng = run.contentRng(`seat:${ps.id}:${door.jid}`);
  // ANYWHERE in the car, evenly, clamped offsets piled them at its ends
  const body = railTrainOf(run, door.jid)?.bodies.find((b) => rx >= b.x0 && rx <= b.x1);
  ps.seatRx = body ? body.x0 + C.M(1.5) + rng() * Math.max(0, body.x1 - body.x0 - C.M(3)) : rx;
  ps.seatRy = (rng() - 0.5) * (C.CAR_WIDTH - C.M(1.4));
  // ...and where they are going: one to four stops down the line
  ps.stopsToGo = 1 + Math.floor(rng() * 4);
  ps.lastStop = ps.placeId;
  const from = asStation(run.places.get(ps.placeId))?.name;
  if (from) ps.dest = destOf(door.jid, from, ps.stopsToGo);
  return true;
}

/** the way out: the nearest escalator's foot, on the map */
export function nearestWayOut(st: Station, ps: Passenger): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  // on THEIR island: nobody crosses the tracks to an escalator
  const mine = islandOf(st, ps.x, ps.y);
  for (const e of st.escalators) {
    if (islandAtLocal(st, e.y) !== mine) continue;
    const at = fromPlatform(st, e.x, e.y);
    const d = dist(at.x - ps.x, at.y - ps.y);
    if (d < bd) {
      bd = d;
      best = at;
    }
  }
  return best;
}
