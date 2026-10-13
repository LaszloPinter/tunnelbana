import * as C from '../config.ts';
import { departuresFrom } from '../core/network.ts';
import { STOCK } from '../core/train.ts';
import { PlatformPath } from '../core/platformPath.ts';
import { legBetween } from '../data/legGeometry.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import { levelOfService, stationPlan } from '../data/platformPlan.ts';
import { stationBands } from '../core/stationLayout.ts';
import { planStation } from './stationPlan.ts';
import { MAX_RAILS, Station } from './station.ts';
import { asStation } from './place.ts';
import type { Run } from './run.ts';

/**
 * BUILDING A STATION: its storey's islands and tracks (the shared band
 * geometry of src/core/stationLayout.ts, with this place's own trains put on
 * them), its centreline, and where its furniture stands. A build is pure in
 * (runSeed, name, levelIndex), it draws only on the place's own stream, so
 * building one is independent of when it happened (§17's load-bearing rule).
 */

/**
 * A station, built whole, without becoming the one we are standing in
 * (§17). This is what lets several be alive at once: it touches nothing on
 * `Run` except the read-only settings.
 */
export function makeStation(run: Run, name: string, levelIndex = 0): Station {
  const st = new Station(name, run.runSeed);
  st.levelIndex = levelIndex;
  layoutInto(run, st);
  buildInto(run, st);
  return st;
}

/**
 * Show a place's storey `levelIndex`. A place presents one storey at a time
 * (§17); arriving on a service that calls at a different level than the one
 * the place happens to be showing re-lays it as that level, BEFORE anyone
 * stands in it, so nothing changes under a player's feet.
 */
export function showLevel(run: Run, st: Station, levelIndex: number) {
  if (st.levelIndex === levelIndex) return;
  st.stashFloor();
  st.levelIndex = levelIndex;
  layoutInto(run, st);
  buildInto(run, st);
  st.restoreFloor();
}

/**
 * Re-lay EVERY platform the run is holding.
 *
 * The bow is a world setting, not a property of the room you happen to be
 * standing in, but it is read at BUILD time (`buildInto` below), and the
 * whole network is built before anything has said what the setting is. So
 * turning it off rebuilt the one platform under your feet and left the other
 * ninety-nine as they were: measured, 67 of 100 stations stood bowed by up to
 * 7.3 m while the setting said flat. Ride to one and its deck curves away
 * under a train that is dead straight, "the train is tilted either inwards
 * or outwards" (from play 2026-09-11), with the sign flipping at the middle.
 */
export function rebuildAll(run: Run) {
  for (const pl of run.places.values()) {
    const st = asStation(pl);
    if (!st) continue;
    layoutInto(run, st);
    buildInto(run, st);
  }
}

/** re-lay and re-dress the place the local seat is looking at */
export function rebuildHere(run: Run) {
  // only a platform is laid out; a bore's shape is its corridor's
  const st = asStation(run.here);
  if (!st) return;
  layoutInto(run, st);
  buildInto(run, st);
}

/**
 * Which storey a service runs from here. Riding a train to a stacked station
 * puts you on the platform that train actually pulls into, not on whatever
 * level happens to be first in the list.
 */
export function levelIndexFor(station: string, service: string, dir: 1 | -1): number {
  const storey = levelOfService(station, service, dir);
  if (storey === null) return 0;
  const i = stationPlan(station).levels.findIndex((l) => l.level === storey);
  return i >= 0 ? i : 0;
}

/** the storeys a place has, and where the storey it is showing sits in them */
function shaftsOf(st: Station): { delta: -1 | 1; label: string }[] {
  const plan = stationPlan(st.name);
  const out: { delta: -1 | 1; label: string }[] = [];
  if (st.levelIndex > 0) out.push({ delta: 1, label: 'UPP' });
  if (st.levelIndex < plan.levels.length - 1) out.push({ delta: -1, label: 'NER' });
  return out;
}

/**
 * Lay out ONE STOREY of a station: its islands, the tracks either side of
 * them, and this place's trains standing on those tracks. The geometry is
 * `stationBands`, the same arithmetic the world threads the line paths
 * through, so the arena and the track can never disagree, and every track
 * takes a rail SLOT in order, whether or not anything departs from it.
 */
export function layoutInto(run: Run, st: Station) {
  const plan = stationPlan(st.name);
  st.levelIndex = Math.max(0, Math.min(st.levelIndex, plan.levels.length - 1));
  const bands = stationBands(st.name, st.levelIndex);
  st.storey = bands.storey;
  st.levelCount = bands.levelCount;
  st.rails = [];
  st.platforms = [];
  const railOfTrack: number[] = [];
  bands.tracks.forEach((track, slot) => {
    const train = st.railTrains[slot];
    train.centerY = (track.bandTop + track.bandBottom) / 2;
    train.dir = track.dir;
    // §5: the red line runs C30s, one continuous corridor, no couplings
    // to ride and no sealed rooms, and the other two run C20s
    train.setStock(track.color === 'red' ? STOCK.c30 : STOCK.c20);
    // turning a slot's train around rebuilds its interior AND re-textures
    // its cars, both used to keep the layout they were created with
    train.setDoorSide(track.inward);
    // A TRAIN IN THE TUNNEL KEEPS RUNNING THROUGH IT. A re-layout (a shaft,
    // a level change, the curve toggle) takes away only what is standing
    // at, arriving at or leaving the platform, a train mid-transit is out
    // on the leg and belongs to the clock.
    if (train.phase !== 'transit') train.despawn();
    // a track that only RECEIVES (a terminus level) has no departures and
    // so no rail; it still holds its slot so slots mean the same everywhere
    if (track.options.length === 0) {
      railOfTrack.push(-1);
      return;
    }
    railOfTrack.push(st.rails.length);
    st.rails.push({
      train,
      slot,
      color: track.color,
      dir: track.dir,
      options: track.options,
      current: track.options[Math.floor(st.rng() * track.options.length)],
      short: train.carCount < train.stock.fullCars,
      edgeY: track.edgeY,
      inward: track.inward,
      bandTop: track.bandTop,
      bandBottom: track.bandBottom,
    });
  });
  st.platforms = bands.platforms.map((pf) => ({
    top: pf.top,
    bottom: pf.bottom,
    color: pf.color,
    railTop: pf.railTop >= 0 ? railOfTrack[pf.railTop] : -1,
    railBottom: pf.railBottom >= 0 ? railOfTrack[pf.railBottom] : -1,
  }));
  st.worldTopY = bands.worldTopY;
  st.worldBottomY = bands.worldBottomY;
  st.lastPhases = st.rails.map(() => 'gone');
  for (let sl = 0; sl < MAX_RAILS; sl++) {
    if (!st.rails.some((r) => r.slot === sl) && st.railTrains[sl].phase !== 'transit')
      st.railTrains[sl].despawn();
  }
  // which slots are in use is also a fact about the PICTURE, but only
  // for the place the local seat is looking at
  if (st === run.places.get(run.hereId)) run.host.railsChanged();
  // no bridges: at an interchange you cross the tracks like everyone's
  // grandmother told you not to
  st.passages = [];
}

/**
 * The station's centreline and its furniture. The DRAWN tunnel spans exactly
 * what the WALKED tunnel spans, the corridor's own arc, and its curve is
 * parameterised by the LEG so both ends agree on its shape.
 */
export function buildInto(run: Run, st: Station) {
  const station = st.name;
  const geo = stationGeo(station);
  const lenPx = C.M(geo.lengthM);
  const x0 = st.worldW / 2 - lenPx / 2;
  const x1 = st.worldW / 2 + lenPx / 2;
  st.path = new PlatformPath(geo, x0, x1, run.curveStrength);
  // WHERE everything stands is the simulation's decision (sim/stationPlan)
  const plan = planStation(station, st.worldW, st.platforms, st.rails, shaftsOf(st));
  st.plan = plan;
  st.buildGen += 1;
  run.buildCount += 1;
  st.platformX0 = plan.platformX0;
  st.platformX1 = plan.platformX1;
  st.outdoor = plan.outdoor;
  st.benches = plan.benches;
  st.pillars = plan.pillars;
  st.escalators = plan.escalators;
  st.shafts = plan.shafts;
  st.manaMachines = plan.manaMachines;
  st.healthMachines = plan.healthMachines;
  st.kiosks = plan.kiosks;
  const deps = departuresFrom(station);
  const legToward = (dir: 1 | -1) => {
    const to = deps.find((d) => d.dir === dir)?.next;
    return to ? legBetween(station, to) : undefined;
  };
  // A leg's darkness is the leg's, not the far end's: the mean of both
  // ends' cover reads the same from either station, so nothing steps.
  const legCover = (dir: 1 | -1): number => {
    const leg = legToward(dir);
    const a = leg?.coverA ?? null;
    const b = leg?.coverB ?? null;
    if (a === null && b === null) return geo.outdoor ? 0 : 1;
    if (a === null) return b as number;
    if (b === null) return a;
    return (a + b) / 2;
  };
  st.coverLeft = legCover(-1);
  st.coverRight = legCover(1);
  // the PICTURE of all of it is the host's business, but only for the place
  // the local seat is in (dressing a neighbour would build ITS neighbours,
  // which would ask for a dress... a stack overflow, found the hard way)
  if (st === run.places.get(run.hereId)) run.host.dressStation();
}
