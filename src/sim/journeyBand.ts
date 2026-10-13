import { journeyById } from '../core/fleet.ts';
import { turnsFrom } from '../core/journeyMotion.ts';
import { bandOfService, stationBands, type BandTrack } from '../core/stationLayout.ts';
import { type Corridor } from '../core/corridor.ts';
import { corridorCarries } from '../core/tube.ts';
import { terminusTrack } from '../core/boreSlots.ts';
import type { Place } from './place.ts';

/**
 * WHICH TRACK a journey uses at `st`, the one answer the rails, the
 * picture and the probes all read. Null when the journey does not call at
 * this storey at all: a stacked station's other storey may lay its band at
 * the very same y, and a body placed by y alone was drawn on the wrong
 * floor, nose to tail with a train going the other way (T-Centralen,
 * 2026-09-03).
 *
 * Through a station it is the band its service runs its direction on. At a
 * TERMINUS the plan decides where it is unambiguous: an arrival takes the
 * track the plan records its direction on, a departure the track whose
 * board lists it. Where the plan is ambiguous (a stub terminus lists the
 * service on both tracks) the tracks ALTERNATE by the parity of the metal's
 * arriving journey, so while one train unloads and turns on track 1 the
 * previous metal is already boarding on track 2.
 */
export function journeyBandAt(st: Place, jid: string): BandTrack | null {
  const j = journeyById(jid);
  if (!j) return null;
  const first = j.stops[0].station === st.name;
  const last = j.stops[j.stops.length - 1].station === st.name;
  if (!first && !last) {
    const band = bandOfService(st.name, j.service.id, j.dir);
    return band && band.levelIndex === st.levelIndex ? band.track : null;
  }
  const svc = j.service;
  const bands = stationBands(st.name, st.levelIndex);
  const svcTracks = bands.tracks.filter((tr) => tr.services.includes(svc.id));
  if (svcTracks.length === 0) return null;
  // two tracks at the end of the line: arrivals on one, departures on the
  // other, exactly as the line path lays them (core/boreSlots.ts)
  const split = terminusTrack(svcTracks, st.name, svc.id, j.dir);
  if (split) return split;
  let matches = last
    ? svcTracks.filter((tr) => tr.dir === j.dir)
    : svcTracks.filter((tr) => tr.options.some((o) => o.service.id === svc.id && o.dir === j.dir));
  // the plan lists a service only where it DEPARTS, so a terminating arrival
  // may have no listed track at all, it runs in on whichever track carries
  // its direction of travel
  if (last && matches.length === 0) matches = bands.tracks.filter((tr) => tr.dir === j.dir);
  if (matches.length !== 1) matches = svcTracks;
  const anchorId = last ? jid : (turnsFrom(jid) ?? jid);
  const anchorK = journeyById(anchorId)?.k ?? 0;
  return matches[((anchorK % matches.length) + matches.length) % matches.length];
}

/**
 * DOES THIS JOURNEY RUN THIS TUBE. A stacked station is several rooms,
 * T-Centralen runs one direction at level -2 and the other at -3, and a
 * corridor joins one room at each end (core/corridor.ts), so a journey runs
 * it exactly when it calls at those rooms. The traffic, the rails, the crush
 * and the picture all ask this one question: a walker crushed by a train
 * running the tunnel below is the worst death in the game.
 */
export function journeyRuns(jid: string, c: Corridor): boolean {
  // asked for every train near every body for every step it might take, and
  // the answer is a fact about the timetable: remembered per tube and train
  let by = runsCache.get(c);
  if (!by) runsCache.set(c, (by = new Map()));
  const hit = by.get(jid);
  if (hit !== undefined) return hit;
  const j = journeyById(jid);
  const runs = !!j && corridorCarries(c, j.service.id, j.dir);
  by.set(jid, runs);
  return runs;
}

const runsCache = new WeakMap<Corridor, Map<string, boolean>>();
