import * as C from '../config.ts';
import { findRoute } from '../core/network.ts';
import { corridorProject, RECESS_HALF } from '../core/corridor.ts';
import type { Station } from './station.ts';
import type { Leg } from './legPlace.ts';
import type { Player } from './player.ts';
import type { Run } from './run.ts';
import { settleIn } from './rideArrival.ts';

/**
 * WHAT A WALK IN A BORE STILL ASKS OF THE RUN. Walking itself is the map's
 * (src/world/walk2d.ts): a body steps, and the ground under it says which
 * room it is in. Left here is what happens when that ground turns out to be
 * a new platform, and where the vendor's window is.
 */

/**
 * THE RUN'S BOOKKEEPING FOR ARRIVING SOMEWHERE ON FOOT: the route from
 * here, a stop travelled, this station's clocks, its wave and its banner.
 * One block, because the map's walker (world/walk2d.ts) arrived without it,
 * the route still said "board at the station you left", missed trains were
 * scored against the wrong leg, and the new station's wave never started.
 */
export function arriveOnFoot(run: Run, st: Station, p: Player, now: number) {
  run.route = findRoute(st.name, run.destStation) ?? [];
  run.stopsTraveled += 1;
  // ...and the run's total: a stop walked to is a stop (the board counted
  // only trains, and a run made mostly on foot showed 6, from play 2026-10-14)
  run.stopsTotal += 1;
  st.stationEnteredAt = now;
  st.manaBuysHere = 0;
  run.host.banner(st.name);
  settleIn(run, now);
  run.showMsg(`You walked the tunnel into ${st.name}.`, now, p);
}

/** the vendor's window: the first or last recess of the leg it trades on */
export function atVendor(run: Run, p: Player): boolean {
  const leg = run.places.get(p.placeId);
  if (!leg || leg.kind !== 'leg') return false;
  const l = leg as Leg;
  if (l.id !== run.vendorLegId) return false;
  // the walker is a point on the map; the vendor's window is an arc along
  // the bore, asked in the bore's own numbers the shop never opened
  const at = corridorProject(l.cor, p.x, p.y);
  if (!l.inRefuge(at.s, at.t, p.r)) return false;
  const centres = l.recessCentres();
  if (centres.length === 0) return false;
  const d0 = Math.abs(at.s - centres[0]);
  const d1 = Math.abs(at.s - centres[centres.length - 1]);
  return Math.min(d0, d1) < RECESS_HALF + C.M(1);
}
