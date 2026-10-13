import * as C from '../config.ts';
import { ALL_STATIONS, departuresFrom } from '../core/network.ts';
import type { Corridor } from '../core/corridor.ts';
import { corridorFor, corridorLevelAt } from '../core/tube.ts';
import { endSignF, frameOf } from '../core/worldNet.ts';
import { bandOfService } from '../core/stationLayout.ts';
import type { Run } from './run.ts';
import { Station } from './station.ts';
import { asLeg, asStation, type Place } from './place.ts';
import { legIdOf } from './leg.ts';
import { journeyById } from '../core/fleet.ts';
import { showLevel } from './stationBuild.ts';

/**
 * THE LIVE PLACES (§17) and how they sit next to each other.
 *
 * Several stations are alive at once, the ones the party is standing in,
 * their neighbours, and whatever has been built ahead, each with its own
 * floor, its own rails and its own horde. A place nobody is in is FROZEN: it
 * keeps everything exactly as it was and does not tick, which is why a
 * station cannot get worse behind your back and a tunnel is quiet.
 */

/** the departures off a station's `e` end ON THE STOREY IT SHOWS */
function departuresOff(name: string, levelIndex: number, e: 1 | -1) {
  const f = frameOf(name, levelIndex);
  if (!f) return [];
  const off = departuresFrom(name).filter((d) => endSignF(f, d.next) === e);
  const here = off.filter((d) => (bandOfService(name, d.service.id, d.dir)?.levelIndex ?? 0) === levelIndex);
  return here.length ? here : off;
}

/**
 * A ROOM: one storey of one station. The map has no up, so a stacked
 * station is several rooms at the same point on it; which of them a line
 * calls at is the only thing that tells them apart.
 */
interface Room {
  name: string;
  levelIndex: number;
}

/**
 * The tubes joined to a room, leaving it AND arriving at it. At T-Centralen
 * the tube from Hötorget carries only southbound green, which calls at the
 * lower hall; nothing DEPARTS that hall toward Hötorget, so counted by
 * departures alone the tube was not the hall's, and its floor vanished
 * under a walker the moment their feet were filed to the tube it overlaps
 * (probe run2d, Hötorget to T-Centralen, 2026-09-18).
 */
function tubesOff(room: Room): Corridor[] {
  const out: Corridor[] = [];
  const consider = (a: string, b: string, serviceId: string, dir: 1 | -1) => {
    const c = corridorFor(a, b, serviceId, dir);
    if (c && corridorLevelAt(c, room.name) === room.levelIndex && !out.includes(c)) out.push(c);
  };
  for (const d of departuresFrom(room.name)) consider(room.name, d.next, d.service.id, d.dir);
  for (const n of new Set(departuresFrom(room.name).map((d) => d.next)))
    for (const d of departuresFrom(n)) if (d.next === room.name) consider(n, room.name, d.service.id, d.dir);
  return out;
}

/** the rooms one stop away from this one: the far room of each tube that
 * leaves it, at the storey the tube joins it on */
function roomsOff(room: Room): Room[] {
  return tubesOff(room).map((c) => {
    const name = c.a === room.name ? c.b : c.a;
    return { name, levelIndex: corridorLevelAt(c, name) };
  });
}

/**
 * EVERY bore off a station's `e` end, on the storey it shows.
 *
 * At six places on the network two lines leave one platform end, Slussen,
 * Gullmarsplan, Skärmarbrink, Liljeholmen, Östermalmstorg, Västra skogen,
 * and at five of the six the two leave at the SAME lateral, because they
 * really do share the metal out of the platform and only part at a switch
 * further along. So the picture is right to draw one tunnel there; what was
 * wrong was that everything ELSE also saw only one, and the second line's
 * traffic became a train that could not be seen, could not hurt you, and
 * then appeared beside you as it reached the platform (from play
 * 2026-09-06). Ask for all of them and the bore carries both.
 */
export function corridorsToward(st: Place, e: 1 | -1): Corridor[] {
  const out: Corridor[] = [];
  for (const dep of departuresOff(st.name, st.levelIndex, e)) {
    const c = corridorFor(st.name, dep.next, dep.service.id, dep.dir);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** the bore off a station's `e` end that the PICTURE draws, at a branch,
 * the first line's, which is the one the art and the walls are built from */
export function corridorToward(st: Place, e: 1 | -1): Corridor | null {
  return corridorsToward(st, e)[0] ?? null;
}

/**
 * The live set, recomputed every tick from simulation state alone, so
 * every client in a room agrees on it without being told (§11c). What is
 * wanted: every occupied place and everything within LIVE_RADIUS hops of
 * it, plus what a foot in a tunnel or a closing door pulls in ahead.
 *
 * PRESENCE IS WHAT MAKES A PLACE ALIVE. Everything in the set ticks, its
 * trains are realised, its horde wanders, its first wave is already on the
 * floor, so the station coming up the tunnel is complete long before it
 * reaches the screen, and arriving changes nothing but who is standing
 * there. The wave CLOCK is the one thing that waits for an occupant
 * (`isOccupied`): a station cannot get worse behind your back.
 */
/** everything the live set depends on, as one string: who is where, in
 * what, and whether their train has begun to leave */
function liveKeyOf(run: Run): string {
  // ...and which STOREY each room shows, and how many builds there have
  // been: a shaft ride changes the room under a player without changing
  // its id, and the tubes off the old storey stayed live (probe storeys2d)
  let key = `${run.buildCount}|`;
  for (const p of run.players) {
    if (!p.alive) continue;
    key += `${p.placeId}#${run.places.get(p.placeId)?.levelIndex ?? 0}/${p.frame.kind}`;
    if (p.frame.kind === 'aboard') key += `/${p.frame.jid ?? ''}`;
    if (C.SPECULATE && p.frame.kind !== 'world') {
      const st = run.places.get(p.placeId);
      if (st?.rails[p.frame.ti]?.train.phase === 'departing') key += '/leaving';
    }
    key += '|';
  }
  return key;
}

export function stepPlaces(run: Run, now: number) {
  // THE ANSWER ONLY CHANGES WHEN SOMEBODY'S SITUATION DOES. Walked every
  // tick, the search below allocated its rooms, queue, tubes and key strings
  // sixty times a second for an answer that was the same for minutes at a
  // time (the third-largest churn left, 2026-09-17). The whole network stays
  // up, so nothing needs its timestamp refreshed either.
  const key = liveKeyOf(run);
  if (key === run.liveKey && run.live.size > 0) return;
  run.liveKey = key;
  /**
   * THE WALK IS OVER ROOMS, NOT STATIONS. It went station to station by
   * every line that called there, whatever storey, so from Fridhemsplan's
   * blue hall it wanted the green line's neighbours, and each of those wanted
   * its bore back to Fridhemsplan's green hall. That bore is a room a flight
   * up, and the map has no up: its floor, its rock, its dark and its traffic
   * were laid straight across the hall you were standing in, and its trains
   * ran diagonally through the platform (from play 2026-09-13). A storey is
   * a room (sim/legPlace.ts), and you reach the next room by a line that
   * leaves THIS one.
   */
  // ...AND ONE STOREY PER STATION: the one nearest to somebody. Two hops
  // from T-Centralen's upper hall is T-Centralen's lower hall, by way of
  // Gamla stan and the other line, and that is the room you are standing
  // over, not a room to bring up around you. Nearest first, so the seeds
  // (where the party is) always win.
  const rooms = new Map<string, Room>();
  const queue: { room: Room; hops: number }[] = [];
  const tubes = new Map<string, Corridor>();
  for (const p of run.players) {
    if (!p.alive) continue;
    const pl = run.places.get(p.placeId);
    const leg = asLeg(pl);
    if (leg) {
      // a walker in a bore wants the bore AND both of its ends standing ready,
      // each at the storey the bore joins it on
      tubes.set(leg.id, leg.cor);
      queue.push({ room: { name: leg.cor.a, levelIndex: leg.cor.la }, hops: C.LIVE_RADIUS });
      queue.push({ room: { name: leg.cor.b, levelIndex: leg.cor.lb }, hops: C.LIVE_RADIUS });
    } else if (pl) queue.push({ room: { name: pl.name, levelIndex: pl.levelIndex }, hops: C.LIVE_RADIUS });
    // A RIDER'S NEXT STOP, at the storey their train calls at, seeded, so it
    // wins over the storey the walk from here would have chosen. The ride
    // re-lays that station for its service (sim/fleetRealise.ts); the walk
    // must not re-lay it back.
    const j = p.frame.kind === 'aboard' && p.frame.jid ? journeyById(p.frame.jid) : null;
    if (j && pl) {
      const i = j.stops.findIndex((s) => s.station === pl.name);
      const next = i >= 0 ? j.stops[i + 1] : undefined;
      if (next)
        queue.push({
          room: {
            name: next.station,
            levelIndex: bandOfService(next.station, j.service.id, j.dir)?.levelIndex ?? 0,
          },
          hops: C.LIVE_RADIUS,
        });
    }
  }
  if (C.SPECULATE) {
    // doors that have begun to close pull in what is on the other side
    // now, even if the rider steps off again
    for (const p of run.players) {
      if (!p.alive) continue;
      const st = run.places.get(p.placeId);
      if (!st) continue;
      const leaving = p.frame.kind !== 'world' && st.rails[p.frame.ti]?.train.phase === 'departing';
      if (leaving) for (const n of roomsOff(st)) queue.push({ room: n, hops: C.LIVE_RADIUS });
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const { room, hops } = queue[i];
    const id = Station.idOf(room.name);
    if (rooms.has(id)) continue;
    rooms.set(id, room);
    if (hops > 0) for (const n of roomsOff(room)) queue.push({ room: n, hops: hops - 1 });
  }
  const want = new Set(rooms.keys());
  // ...AND EVERY TUBE OFF A LIVE ROOM, so a walk into one is not a build,
  // but only a tube whose far end agrees with the room shown there. From
  // Gamla stan two tubes leave for T-Centralen, one to each of its halls;
  // with the lower hall shown, the tube to the upper one lands on a mouth
  // that is not there, at that hall's own bearing, and so ran diagonally
  // across the floor with its trains on it.
  for (const room of rooms.values())
    for (const c of tubesOff(room)) {
      const far = c.a === room.name ? c.b : c.a;
      const shown = rooms.get(Station.idOf(far));
      if (shown && shown.levelIndex !== corridorLevelAt(c, far)) continue;
      tubes.set(legIdOf(c), c);
    }
  for (const id of want) run.wantedAt.set(id, now);
  for (const name of [...want].map((id) => id.slice(3))) run.ensurePlace(name);
  // ...AND EACH SHOWS THE STOREY THE WALK CHOSE. The tube from here lands on
  // one hall of a stacked station; if the station stood showing another,
  // the tube ended on a mouth with no floor behind it and there was no way
  // across the map into it (probe nopop, Stadshagen to Fridhemsplan). A room
  // somebody is standing in is never re-laid under them, it was the seed.
  for (const room of rooms.values()) {
    const st = asStation(run.places.get(Station.idOf(room.name)));
    if (!st || st.levelIndex === room.levelIndex) continue;
    if (run.players.some((q) => q.alive && q.placeId === st.id)) continue;
    showLevel(run, st, room.levelIndex);
  }
  // the bores between them are places too, and they tick with their stations
  for (const [id, c] of tubes) {
    run.ensureLeg(c);
    want.add(id);
    run.wantedAt.set(id, now);
  }
  run.live = want;

  // the whole network stays up: nothing is evicted, and anything a handover
  // displaced from the registry is put back (a build is pure, so this is
  // cheap and order-independent)
  if (C.WHOLE_NETWORK) {
    for (const n of ALL_STATIONS) if (!run.places.has(Station.idOf(n))) run.ensurePlace(n);
    return;
  }

  // take down what nobody has wanted for a while, never a place holding a
  // seat, and never the one the local seat is looking at
  const held = new Set<string>([run.hereId, ...run.players.filter((p) => p.alive).map((p) => p.placeId)]);
  const spare = [...run.places.keys()]
    .filter((id) => !held.has(id) && !want.has(id))
    .sort((a, b) => (run.wantedAt.get(a) ?? 0) - (run.wantedAt.get(b) ?? 0));
  for (const id of spare) {
    const stale = now - (run.wantedAt.get(id) ?? 0) > C.EVICT_AFTER_MS;
    const over = run.places.size > C.MAX_LIVE;
    if (!stale && !over) break;
    run.places.delete(id);
    run.hosts.delete(id);
    run.wantedAt.delete(id);
  }
}

/** the live places in a fixed order, so four clients step them alike */
export function liveInOrder(run: Run): Place[] {
  return [...run.places.keys()].sort().map((id) => run.places.get(id)!);
}

/** does anything happen here this tick? A place out of everyone's reach is frozen */
export function isFrozen(run: Run, st: Place): boolean {
  return !run.live.has(st.id);
}

/** somebody is standing in it: its waves run, its dark creeps */
export function isOccupied(run: Run, st: Place): boolean {
  return run.players.some((p) => p.alive && p.placeId === st.id);
}
