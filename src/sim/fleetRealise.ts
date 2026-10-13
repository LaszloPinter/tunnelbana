import * as C from '../config.ts';
import { shortName } from '../core/network.ts';
import type { Rail } from '../core/world.ts';
import { isShortTrain, journeyById, journeysAt, journeysOfServiceNear, stopAt } from '../core/fleet.ts';
import { journeyS, motionOf, ownsMetalAt } from '../core/journeyMotion.ts';
import { spawnAboardEnemies } from '../combat/enemyCrawlIn.ts';
import { anyoneAboard } from './player.ts';
import type { Run } from './run.ts';
import type { Station } from './station.ts';
import { journeyBandAt, onLocalStretch, trainLeftX } from './legView.ts';
import { isOccupied } from './places.ts';
import { levelIndexFor, showLevel } from './stationBuild.ts';

/**
 * REALISE THE FLEET (the one-world build, CUT-1).
 *
 * A rail's `Train` object is a BODY, not a lifecycle: every tick its
 * position, speed, doors and length are read off its journey's motion
 * (src/core/journeyMotion.ts), unrolled into the arena around this
 * station's own stop point (src/sim/legView.ts, the same mapping the
 * picture uses). There is no spawn and no despawn anywhere any more: the
 * journey the rail shows was somewhere real before it arrived and is
 * somewhere real after it leaves, and at a terminus the body runs visibly
 * into the siding, rests, and comes back as the paired return journey,
 * the same metal, owned by exactly one journey at a time.
 */

/**
 * A place nobody is in is FROZEN, and its rails must not keep bodies posed
 * where they were: anyone walking back would meet a train that had stood
 * still for a minute and then jumped. The rails let go of their journeys;
 * the next tick anyone is standing there realises the fleet afresh. (What
 * was aboard leaves with the journey, as it does whenever a rail changes.)
 */
export function freezeRails(st: Station) {
  for (let ti = 0; ti < st.rails.length; ti++) {
    const rail = st.rails[ti];
    if (!rail.journey && !rail.train.active()) continue;
    cullTrainEntitiesIn(st, ti);
    rail.journey = null;
    rail.train.despawn();
    st.lastPhases[ti] = 'gone';
  }
}

export function driveTrains(run: Run, st: Station, now: number) {
  for (let ti = 0; ti < st.rails.length; ti++) driveRail(run, st, ti, now);
}

function driveRail(run: Run, st: Station, ti: number, now: number) {
  const rail = st.rails[ti];
  const t = rail.train;
  // the ridden journey is sticky: a ride ends through the braking-point
  // place change, never by the body being reassigned under the riders
  const ridden = st.id === run.hereId && anyoneAboard(run.players, ti);
  const jid = ridden && rail.journey ? rail.journey : pickJourneyForRail(st, rail, now);
  const j = jid ? journeyById(jid) : undefined;
  const mo = jid ? motionOf(jid) : null;
  const stopIdx = j ? j.stops.findIndex((s) => s.station === st.name) : -1;
  if (!jid || !j || !mo || stopIdx < 0) {
    // the body goes, and whatever was aboard goes with it, it used to stay
    // in its seat with no car under it, floating on the band (from play
    // 2026-09-04)
    if (rail.journey) cullTrainEntitiesIn(st, ti);
    rail.journey = null;
    if (t.phase !== 'gone') t.despawn();
    return;
  }
  if (rail.journey !== jid) {
    // the body changes journeys: whatever was aboard the old one left with it
    cullTrainEntitiesIn(st, ti);
    rail.journey = jid;
    rail.current =
      rail.options.find((o) => o.service.id === j.service.id && o.dir === j.dir) ??
      rail.options.find((o) => o.service.id === j.service.id) ??
      rail.current;
    rail.short = isShortTrain(jid);
    t.setCars(rail.short ? t.stock.shortCars : t.stock.fullCars);
    // a newly arriving train may carry a crawl-in, and the board speaks
    // when it is YOUR train (only worth saying once it is nearly here)
    if (now < j.stops[stopIdx].arriveAt) {
      // the crawl-in is for the place the party is IN: a neighbour's trains
      // are somebody else's problem (enemies.ts spawnAboardEnemies)
      if (isOccupied(run, st) && !run.tutorial) spawnAboardEnemies(run.hostFor(st), ti, now, jid);
      if (st.id === run.hereId && j.stops[stopIdx].arriveAt - now < 45_000) {
        const leg = run.route[0];
        if (leg && rail.current.service.id === leg.service.id && rail.current.dir === leg.dir)
          run.showMsg(`Your ${leg.service.id} toward ${shortName(leg.terminus)} is arriving!`, now);
      }
    }
  }
  // WHERE YOU ARE GOING is settled while the train is still moving: which
  // storey a station presents depends on the service arriving at it, and
  // deciding that at the platform re-laid the place you had been watching
  // through the window, so that storey's trains appeared from nothing
  // (from play 2026-09-05, the same fault as arriving on foot)
  if (ridden) {
    const next = j.stops[stopIdx + 1];
    const dest = next ? run.ensurePlace(next.station) : null;
    if (dest && !run.players.some((q) => q.alive && q.placeId === dest.id))
      showLevel(run, dest, levelIndexFor(next!.station, j.service.id, j.dir));
  }
  placeTrainBody(st, ti, jid, now);
}

/** put a rail's body exactly where its journey's motion says it is, and
 * derive phase and doors from the schedule, pure arithmetic, every tick */
export function placeTrainBody(st: Station, ti: number, jid: string, now: number) {
  const rail = st.rails[ti];
  const t = rail.train;
  const j = journeyById(jid);
  const stopIdx = j ? j.stops.findIndex((s) => s.station === st.name) : -1;
  if (!j || stopIdx < 0) return;
  const js = journeyS(jid, now);
  const left = js ? trainLeftX(st, jid, js.S, t.length) : null;
  if (!js || !left) return;
  t.x = left.x;
  t.speed = js.speed * left.dlx;
  t.dir = left.dlx;
  const stop = j.stops[stopIdx];
  t.arriveAt = stop.arriveAt;
  t.departAt = stop.departAt;
  if (now < stop.arriveAt) {
    t.phase = 'arriving';
    t.doorFrac = 0;
  } else if (now <= stop.departAt) {
    t.phase = 'dwell';
    const openStart = stop.arriveAt + C.DOOR_OPEN_DELAY_MS;
    const closeStart = stop.departAt - C.DOOR_CLOSE_LEAD_MS;
    const opening = now < openStart ? 0 : Math.min(1, (now - openStart) / C.DOOR_OPENING_MS);
    const closing = now < closeStart ? 1 : Math.max(0, 1 - (now - closeStart) / C.DOOR_CLOSING_MS);
    t.doorFrac = Math.min(opening, closing);
  } else {
    // departing, and once the whole body is clear of the platform it is in
    // TRANSIT: out on the leg, where the ride's own attacks run and the
    // platform's spawner rests (combat.ts reads this)
    const clear = t.x > st.platformX1 || t.x + t.length < st.platformX0;
    t.phase = clear ? 'transit' : 'departing';
    t.doorFrac = 0;
  }
  t.doorsOpen = t.doorFrac > 0.05;
}

/**
 * Which journey this rail shows: among every journey of its services whose
 * stop here is near now, terminating arrivals included, the one whose
 * train is physically nearest this station's stop point, provided it stops
 * on THIS band of THIS storey and owns its metal at this moment.
 */
function pickJourneyForRail(st: Station, rail: Rail, now: number): string | null {
  const services = new Set(rail.options.map((o) => o.service));
  let best: string | null = null;
  let bestD = Infinity;
  const sameBand = (b: { bandTop: number; bandBottom: number }) =>
    Math.abs(b.bandTop - rail.bandTop) <= 0.5 && Math.abs(b.bandBottom - rail.bandBottom) <= 0.5;
  for (const svc of services) {
    for (const cand of journeysOfServiceNear(svc, st.name, now, C.HEADWAY_MS * 2)) {
      // its track here, the one answer the picture reads too (legView)
      const band = journeyBandAt(st, cand.id);
      if (!band || !sameBand(band)) continue;
      if (!ownsMetalAt(cand.id, now)) continue;
      const moC = motionOf(cand.id);
      const idx = cand.stops.findIndex((s) => s.station === st.name);
      if (!moC || idx < 0) continue;
      const js = journeyS(cand.id, now)!;
      // ON THIS STATION'S OWN STRETCH: at the platform, in a siding off it,
      // or on a leg adjoining it. A rail used to keep showing a train that
      // was already dwelling one station away, its body sat a whole leg off
      // the platform, a puppet nobody could see and the board counted down
      // to (from the turnaround probe, 2026-09-03).
      if (!onLocalStretch(st, cand.id, js.S)) continue;
      // ONE BODY PER RAIL is a render budget, and the budget leans toward
      // what moves: metal parked in a siding carries a screen's worth of
      // handicap, so a train racing somebody down the leg keeps its body
      // instead of the puppet snapping back to the parked one. The handicap
      // is a distance, not a veto, with nothing else near, the parked train
      // stays visibly at rest.
      const resting = js.speed === 0 && (js.S <= 0.5 || js.S >= moC.path.length - 0.5) ? C.M(300) : 0;
      const d = Math.abs(js.S - moC.path.stopS[idx]) + resting;
      if (d < bestD) {
        bestD = d;
        best = cand.id;
      }
    }
  }
  return best;
}

/**
 * When the next train reaches this platform, the one the board counts down
 * to. It is the train that is actually coming: the one already scheduled
 * onto the track if there is one, and otherwise the fleet's next journey
 * that this track serves.
 */
export function nextArrivalAt(st: Station, ti: number, now: number): number | null {
  const rail = st.rails[ti];
  if (!rail) return null;
  if (rail.train.active() && rail.train.arriveAt > now) return rail.train.arriveAt;
  const serves = (j: { service: { id: string }; dir: 1 | -1 }) =>
    rail.options.some((o) => o.service.id === j.service.id && o.dir === j.dir);
  for (const j of journeysAt(st.name, now, 0, C.HEADWAY_MS * 3)) {
    if (!serves(j)) continue;
    const at = stopAt(j, st.name);
    if (at && at.arriveAt > now) return at.arriveAt;
  }
  return null;
}

/** a rail's body changed journeys: whatever was aboard the old journey
 * left with it, it is somewhere on the network, just not here */
export function cullTrainEntitiesIn(st: Station, ti: number) {
  st.enemies = st.enemies.filter((e) => !(e.frame.kind === 'aboard' && e.frame.ti === ti));
  st.boardings = st.boardings.filter((bd) => bd.ti !== ti);
  st.strikes = st.strikes.filter((sk) => sk.ti !== ti);
  const cull = <T extends { frame: 'world' | 'train'; ti: number }>(arr: T[]) =>
    arr.filter((it) => !(it.frame === 'train' && it.ti === ti));
  st.coins = cull(st.coins);
  st.pickups = cull(st.pickups);
  st.stains = cull(st.stains);
  st.projs = cull(st.projs);
  st.acidPools = cull(st.acidPools);
}
