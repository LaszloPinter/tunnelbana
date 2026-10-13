import { asLeg, asStation, type Place } from '../sim/place.ts';
import type { Train } from '../core/train.ts';
import { boreTraffic } from '../sim/bore.ts';
import { journeyRuns } from '../sim/journeyBand.ts';
import { levelIndexFor } from '../sim/stationBuild.ts';
import type { Run } from '../sim/run.ts';
import * as C from '../config.ts';
import { frameOf } from '../core/worldNet.ts';
import { bodyAt, trainBody, trainCars } from './trains2d.ts';
import { unitsOf } from './trainSeat.ts';
import { journeyById, journeysOfServiceNear } from '../core/fleet.ts';
import { ownsMetalAt } from '../core/journeyMotion.ts';
import { fromPlatform } from './floor.ts';
import type { Station } from '../sim/station.ts';

/**
 * WHOSE METAL COULD BE HERE.
 *
 * Every journey realised on a live platform, and every train running the live
 * bores. It is deliberately the same set the picture draws from: a train you
 * can be crushed by and a train you can see have to be the same train, and
 * they were not, a walker was once killed by traffic on another storey that
 * was rightly never drawn.
 *
 * The point is not used to narrow it yet; the live set is already small, and
 * narrowing by position is a job for the grid once the metal is baked into it.
 */
/**
 * IS THIS TRACK'S TRAIN STANDING WITH ITS DOORS OPEN, the one thing that
 * lets a body off a deck and onto the tracks without a dash.
 *
 * It was always the exception to a platform's edge, and it was always about
 * the TRACK you were stepping onto rather than about how near the metal is:
 * the gap between a deck and a car is a step, and a door being open is what
 * makes it one. The map already says which bed a point is on, so the rule
 * needs nothing measured.
 */
export function doorOpenOn(place: Place, index: number): boolean {
  const st = asStation(place);
  const rail = st?.rails[index];
  if (!rail || !rail.journey) return false;
  const t = rail.train;
  return t.active() && t.doorsOpen && Math.abs(t.speed) <= C.TRAIN_CRUSH_MIN;
}

/** the metal itself, when this journey is standing at a live platform, the
 * one place a train's doors, couplings and interior are known */
const railCache = new WeakMap<Run, { at: number; live: number; by: Map<string, Train> }>();

export function railTrainOf(run: Run, jid: string): Train | null {
  // the same reasoning as metalNear: asked once per body per candidate step,
  // and a scan of every live platform's rails each time
  let hit = railCache.get(run);
  if (!hit || hit.at !== run.gameNow || hit.live !== run.live.size) {
    const by = new Map<string, Train>();
    for (const id of run.live) {
      const st = asStation(run.places.get(id));
      if (!st) continue;
      for (const rail of st.rails) if (rail.journey) by.set(rail.journey, rail.train);
    }
    hit = { at: run.gameNow, live: run.live.size, by };
    railCache.set(run, hit);
  }
  return hit.by.get(jid) ?? null;
}

/**
 * IS THIS TRAIN A WALL, JUST HERE? A car standing still with its doors open
 * is not, but only ACROSS ITS DOORWAY. A door is a metre and a half of a
 * hundred-and-forty-metre train, and treating the whole flank as open the
 * moment the doors slid back let a body walk in through the bodywork
 * anywhere along it (from play 2026-09-10). The train has always known its
 * own layout, doorways, coupling gaps, how far the leaves have slid
 * (core/train.ts solidAt), so the map asks it, at the place along the train
 * that the body is standing.
 *
 * A train out in a bore has no realised metal at a platform and no open
 * doors: it is wall from end to end.
 */
export function metalSolidAt(run: Run, jid: string, along: number, r: number): boolean {
  const t = railTrainOf(run, jid);
  if (!t || !t.active()) return true;
  if (Math.abs(t.speed) > C.TRAIN_CRUSH_MIN) return true;
  // the layout is measured from the train's left edge and `along` from its
  // tail; with uniform cars the doors and couplings sit symmetrically, so the
  // two agree, the same reason the baked art (render/trainArt.ts, always
  // drawn nose-right) can be laid along a train running either way.
  return t.solidAt(t.x + along, r);
}

/**
 * ...ONCE A TICK. Enumerating it means asking every live bore what is
 * running through it, which means walking the timetable, and every body on
 * the map asks this for every direction it might step, which is seventeen
 * times a body (src/world/body2d.ts). At fifteen bodies that was a quarter of
 * a second of simulation per frame (measured in play, 2026-09-11: "sim
 * 147.10ms  draw 0.60ms"). The answer cannot change within a tick: it is a
 * function of the clock and of which places are live.
 */
const nearCache = new WeakMap<Run, { at: number; live: number; ids: string[] }>();

export function metalNear(run: Run, _x: number, _y: number): string[] {
  const hit = nearCache.get(run);
  if (hit && hit.at === run.gameNow && hit.live === run.live.size) return hit.ids;
  const out = new Set<string>();
  for (const id of run.live) {
    const pl = run.places.get(id);
    if (!pl) continue;
    const st = asStation(pl);
    if (st) {
      for (const rail of st.rails) if (rail.journey) out.add(rail.journey);
      // ...AND WHAT STANDS IN ITS SIDINGS. A rail only names the train at
      // the platform, and a bore only the traffic between two mouths; a
      // train resting in a terminus's siding is on neither, so it was not
      // drawn until it pulled up to the platform, appearing ninety metres
      // from a walker on the deck (probe nopop, Åkeshov, 2026-09-16).
      for (const svc of new Set(st.rails.flatMap((r) => r.options.map((o) => o.service)))) {
        for (const j of journeysOfServiceNear(svc, st.name, run.gameNow, SIDING_WINDOW)) {
          if (out.has(j.id)) continue;
          // ...and only a journey that OWNS its metal: every future journey
          // of a line "rests" at the head of the same siding before it
          // emerges, and drawing them all parked a train on the buffer stop
          // for each (from play 2026-09-16: trains parked beside the tunnel)
          if (!ownsMetalAt(j.id, run.gameNow)) continue;
          const body = trainBody(j.id, run.gameNow);
          if (body && nearStation(st, body.box)) out.add(j.id);
        }
      }
      continue;
    }
    const leg = asLeg(pl);
    if (leg) for (const tr of boreTraffic(run, leg)) out.add(tr.jid);
  }
  const ids = [...out];
  nearCache.set(run, { at: run.gameNow, live: run.live.size, ids });
  return ids;
}

/** how far either side of "now" a train may be on the timetable and still
 * be standing in a siding beside the platform */
const SIDING_WINDOW = 6 * 60_000;
/** how far past a platform's own footprint its sidings reach */
const SIDING_REACH = C.M(250);

/** does this box come within a siding's reach of the station's footprint? */
/** each station's footprint on the map, remembered per build */
const footprints = new WeakMap<Station, { gen: number; x0: number; y0: number; x1: number; y1: number }>();

function footprintOf(st: Station) {
  const hit = footprints.get(st);
  if (hit && hit.gen === st.buildGen) return hit;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const lx of [st.platformX0, st.platformX1])
    for (const ly of [st.worldTopY, st.worldBottomY]) {
      const q = fromPlatform(st, lx, ly);
      x0 = Math.min(x0, q.x);
      y0 = Math.min(y0, q.y);
      x1 = Math.max(x1, q.x);
      y1 = Math.max(y1, q.y);
    }
  const out = { gen: st.buildGen, x0, y0, x1, y1 };
  footprints.set(st, out);
  return out;
}

function nearStation(st: Station, box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const { x0, y0, x1, y1 } = footprintOf(st);
  return (
    box.x1 > x0 - SIDING_REACH &&
    box.x0 < x1 + SIDING_REACH &&
    box.y1 > y0 - SIDING_REACH &&
    box.y0 < y1 + SIDING_REACH
  );
}

/**
 * WHICH ROOM IS THIS BODY IN NOW. On the map that is a lookup: the ground
 * under it says which place it belongs to, and moving between them is not a
 * crossing but a fact about where it is standing.
 */
export function reroom(run: Run, from: Place, e: { x: number; y: number }) {
  const on = run.map.at(e.x, e.y, from.id);
  if (!on || on.place.id === from.id) return;
  const list = from.enemies as unknown as { x: number; y: number }[];
  const i = list.indexOf(e);
  if (i < 0) return;
  list.splice(i, 1);
  (on.place.enemies as unknown as { x: number; y: number }[]).push(e);
}

/** the last side each journey's doors were known to face, in travel terms,
 * a train in a bore has no platform to ask, and its doors are shut anyway */
const doorSides = new WeakMap<Run, Map<string, 1 | -1>>();
const doorN = (run: Run) => {
  let m = doorSides.get(run);
  if (!m) doorSides.set(run, (m = new Map()));
  return m;
};

/**
 * WHICH SIDE OF ITS OWN TRAVEL a train's doors are on.
 *
 * A station's plan says "the doors face +y", meaning +y in THAT ROOM: its
 * deck is on that side of its tracks. The map lays the train along its line,
 * and a line runs the way the train travels, which at half the network's
 * stops is the room's own axis REVERSED (measured: 152 of 304 station pieces
 * run -x). There the two conventions are mirror images, and a train drawn by
 * the room's number has its doors, its seats and its whole interior on the
 * wrong side of itself: the leaves slide open against the tunnel wall (from
 * play 2026-09-11).
 *
 * So the side is asked in the frame everything on the map is asked in, the
 * train's own heading, and the room's number is turned into it.
 */
export function doorNormalOf(run: Run, jid: string, now: number): 1 | -1 {
  const j = journeyById(jid);
  const at = trainCars(jid, now);
  const st = j ? stationAtOf(run, jid) : null;
  // ...PER RUN: a module-wide memory answered from whatever an earlier run
  // in the same tab had seen, and a fresh validator process had seen
  // nothing, two clients, two answers, one fingerprint mismatch
  if (!j || !at || !st) return doorN(run).get(jid) ?? 1;
  const p = at(0);
  const f = frameOf(st.name, st.levelIndex);
  if (!p || !f) return doorN(run).get(jid) ?? 1;
  // which way round the train lies in that room: +1 when its heading runs
  // with the room's own x, -1 when against it
  const dlx = p.tx * f.ux + p.ty * f.uy >= 0 ? 1 : -1;
  const side = (st.doorSide * dlx) as 1 | -1;
  doorN(run).set(jid, side);
  return side;
}

/** the platform a journey's metal is standing at, if any is */
export function stationAtOf(run: Run, jid: string) {
  for (const id of run.live) {
    const st = asStation(run.places.get(id));
    if (!st) continue;
    for (const rail of st.rails)
      if (rail.journey === jid)
        return { name: st.name, levelIndex: st.levelIndex, doorSide: rail.train.doorSide, train: rail.train };
  }
  return null;
}

/**
 * DOES A CAR'S SIDE STOP THIS SHOT?
 *
 * A train is a wall with doorways in it for a body (metalSolidAt above), and
 * it is the same wall for a bolt: shots were flying through the bodywork,
 * through the seats and out the far side, so a vätte two cars away could
 * trade fire with you through solid steel (from play 2026-09-11). What
 * matters is the CROSSING, a bolt fired down an aisle stays in the car it is
 * in, and one fired at the flank stops on it unless it is aimed at an open
 * door.
 */
export function metalStops(run: Run, x0: number, y0: number, x1: number, y1: number, r = 0): boolean {
  for (const jid of run.metalNear(x1, y1)) {
    const body = trainBody(jid, run.gameNow);
    if (!body) continue;
    const was = bodyAt(body, x0, y0, r);
    const now = bodyAt(body, x1, y1, r);
    if (was !== null && now !== null) {
      // ...AND THE BULKHEADS INSIDE IT. A C20 is three sealed units coupled
      // together, not one corridor: the bellows between them is a wall, and
      // shots were crossing it (from play 2026-09-11: "I can still shoot from
      // one car to the other"). That a unit is a room is the whole tactical
      // difference between the two kinds of stock (core/train.ts).
      if (unitAt(jid, was) !== unitAt(jid, now)) return true;
      continue;
    }
    if ((was === null) === (now === null)) continue;
    // it went through the skin somewhere: at a doorway, or through the side
    const along = now ?? was!;
    if (metalSolidAt(run, jid, along, r)) return true;
  }
  return false;
}

/** which of a train's sealed bodies a distance from the tail falls in */
function unitAt(jid: string, along: number): number {
  return unitsOf(jid).findIndex((b) => along >= b.x0 && along <= b.x1);
}

/**
 * IS THIS JOURNEY'S METAL ON THE STOREY THIS POINT IS ON?
 *
 * A stacked station is several rooms at the same place on the map, one above
 * another, and the map has no up. Only the storey being shown has its ground
 * baked, so a train running the tube below is laid across the hall you are
 * standing in, drawn over it, and SOLID in it. At Fridhemsplan that put an
 * invisible wall across the platform that nothing could get past, on a train
 * two floors down (from play 2026-09-12: "train above blocking enemies on
 * this level? OR what is that invisible gate?").
 *
 * The same rule serves the picture and the floor, which is the point: what
 * you can walk into and what you can see have to be the same metal.
 */
export function sameStorey(run: Run, jid: string, x: number, y: number, inside?: string): boolean {
  const on = run.map.at(x, y, inside)?.place ?? null;
  const j = journeyById(jid);
  if (!on || !j) return true;
  const st = asStation(on);
  if (st) return levelIndexFor(st.name, j.service.id, j.dir) === st.levelIndex;
  const leg = asLeg(on);
  return !leg || journeyRuns(jid, leg.cor);
}
