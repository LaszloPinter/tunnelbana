import { corridorOf, type Corridor } from '../core/corridor.ts';
import { mouthSpanOf } from './bore.ts';
import { Leg } from './legPlace.ts';
import { asLeg, asStation, type Place } from './place.ts';
import { PlaceHost } from './placeHost.ts';
import { liveInOrder } from './places.ts';
import type { Run } from './run.ts';
import { Station } from './station.ts';
import { makeStation } from './stationBuild.ts';
import { legIdOf } from './leg.ts';

/**
 * BUILDING THE CHAIN. The world is stations and the bores between them, and
 * both are places (sim/place.ts), built on demand, kept in one registry,
 * hosted the same way. A build is pure in (runSeed, identity), so which one
 * happens first can never change what any of them is.
 */

/** a station, built if it is not up yet */
export function ensureStation(run: Run, name: string): Station {
  const id = Station.idOf(name);
  let st = asStation(run.places.get(id));
  if (!st) {
    st = makeStation(run, name);
    run.places.set(id, st);
    run.hosts.set(id, new PlaceHost(run, st));
  }
  run.wantedAt.set(id, run.gameNow);
  return st;
}

/**
 * ...and the TUNNEL between two of them. Both its end stations have to exist
 * first, because a bore opens out to the width of the platform it joins and
 * that is the one thing about itself a leg cannot work out alone.
 */
export function ensureLeg(run: Run, c: Corridor): Leg {
  const id = legIdOf(c);
  const had = asLeg(run.places.get(id));
  const a = ensureStation(run, c.a);
  const b = ensureStation(run, c.b);
  // a bore's shape is its two platforms', so it follows them across a re-lay
  const stamp = `${a.buildGen}:${a.levelIndex}|${b.buildGen}:${b.levelIndex}`;
  if (had) {
    if (had.remeasure(mouthSpanOf(a, c), mouthSpanOf(b, c), stamp)) run.buildCount += 1;
    run.wantedAt.set(id, run.gameNow);
    return had;
  }
  const leg = new Leg(c, mouthSpanOf(a, c), mouthSpanOf(b, c), run.runSeed);
  leg.remeasure(mouthSpanOf(a, c), mouthSpanOf(b, c), stamp);
  run.places.set(id, leg);
  run.hosts.set(id, new PlaceHost(run, leg));
  run.wantedAt.set(id, run.gameNow);
  return leg;
}

/** the bore between two neighbouring platforms, if one runs there */
export function legBetween(run: Run, a: string, b: string): Leg | null {
  const c = corridorOf(a, b);
  return c ? ensureLeg(run, c) : null;
}

/** every platform alive right now, in the graph's fixed order */
export function liveStations(run: Run): Station[] {
  return liveInOrder(run)
    .map((pl) => asStation(pl))
    .filter((st): st is Station => st !== null);
}

/** the host that steps one place, with its seats refreshed */
export function hostOf(run: Run, pl: Place): PlaceHost {
  let h = run.hosts.get(pl.id);
  if (!h) {
    h = new PlaceHost(run, pl);
    run.hosts.set(pl.id, h);
  }
  h.refresh();
  return h;
}
