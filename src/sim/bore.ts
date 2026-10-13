import * as C from '../config.ts';
import { type Corridor } from '../core/corridor.ts';
import { corridorLevelAt, corridorMouth } from '../core/tube.ts';
import { stationBands } from '../core/stationLayout.ts';
import { boreWallOf } from '../core/boreSlots.ts';
import { corridorTrains, type CorridorTrain } from '../core/corridorTraffic.ts';
import { journeyRuns } from './journeyBand.ts';
import type { Leg } from './legPlace.ts';
import type { Run } from './run.ts';
import { legColor } from './leg.ts';
import type { Place } from './place.ts';

/**
 * WHAT A BORE IS MADE OF, for whoever has to build one. The width of a leg,
 * the traffic in its tube, and what a moving car does to anything standing
 * in it, one arithmetic, shared by the walker and by the horde out there
 * with them.
 *
 * The bore's SHAPE belongs to the leg itself (sim/legPlace.ts) now that a
 * leg is a place; what is left here is the two things a leg cannot answer
 * alone: how wide its mouths open (that is the station's business) and which
 * trains are running it (that is the timetable's).
 */

/**
 * HOW FAR A BORE MUST OPEN AT THIS MOUTH TO MEET THE PLATFORM, as the leg's
 * own lateral, and SEPARATELY EITHER SIDE.
 *
 * A station's floor is not centred on the bore it joins: at T-Centralen the
 * mouth sits beside the lower track, with three times as much floor above it
 * as below. Opening the bore symmetrically to reach the far edge therefore
 * reached a quarter of the platform's width PAST the near one, and a walker
 * could stand at the mouth on floor the station does not have (from play
 * 2026-09-07: "I cannot be that low there"). Each side opens to what is
 * actually there.
 */
export function mouthSpanOf(st: Place, c: Corridor): { lo: number; hi: number } {
  const wall = boreWallOf(c);
  if (st.rails.length === 0 && st.platforms.length === 0) return { lo: -wall, hi: wall };
  // THE STOREY THE TUBE JOINS, from the plan, not whichever storey the
  // station happens to be showing. Two tubes leave Gamla stan for
  // T-Centralen, one to each of its halls, and the one that lands a flight
  // from the shown hall must still open to ITS hall's width.
  const li = corridorLevelAt(c, st.name);
  const bands = stationBands(st.name, li);
  const m = corridorMouth(c, st.name, li);
  let lo = -wall;
  let hi = wall;
  const see = (y: number) => {
    const t = (y - m.y) * m.sign;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  };
  for (const rl of bands.tracks) {
    see(rl.bandTop);
    see(rl.bandBottom);
  }
  for (const pf of bands.platforms) {
    see(pf.top);
    see(pf.bottom);
  }
  return { lo, hi };
}

/**
 * THE TRAFFIC IN THE TUBE THIS WALKER IS IN.
 *
 * A corridor is one object per pair of stations, but a stacked station is
 * several rooms: T-Centralen runs one direction at level -2 and the other
 * at -3, and those are separate tunnels you get between by shaft. The line
 * paths therefore put BOTH storeys' services on the one corridor, and
 * `corridorTrains` hands back all of them, so a walker on one storey could
 * be crushed by a train running the other, which the picture rightly never
 * drew. An invisible train is the worst death in the game.
 *
 * The picture's rule is the one rule: a journey belongs to this chart when
 * it has a band on this storey (sim/journeyBand.ts). The crush asks the
 * same question, so the trains that can kill you are exactly the trains you
 * can see.
 */
export function boreTraffic(run: Run, leg: Leg): CorridorTrain[] {
  const mine = corridorTrains(leg.cor, run.gameNow, legColor(leg.cor)).filter((tr) =>
    journeyRuns(tr.jid, leg.cor),
  );
  // ...and said in the one frame, like everything else in the room. A leg's
  // traffic is enumerated in the CORRIDOR's arc, which is the network's
  // coordinate and not the world's; half the bores in the net are laid end
  // for end, and a train reported in the wrong one runs backwards through
  // the rock. Converted here, once, so nothing downstream, the crush, the
  // warning, the shove, the picture, ever meets an arc.
  return mine.map((tr) => ({
    ...tr,
    s: leg.xOf(tr.s),
    t: leg.yOf(tr.t),
    latAt: (x: number) => leg.yOf(tr.latAt(leg.arcOf(x))),
    vS: tr.vS,
  }));
}

/**
 * IS A MOVING CAR OCCUPYING THIS POINT OF A LEG? The same test the walker
 * gets (sim/legWalk.ts), the tunnel treated the walker and the horde
 * differently once, and a train ran through a pack of vättar killing nobody
 * while the same train killed the player (from play 2026-09-04).
 */
export function legCrush(run: Run, leg: Leg, x: number, y: number, r: number): boolean {
  if (leg.inRefuge(x, y, r)) return false;
  for (const tr of boreTraffic(run, leg)) {
    if (Math.abs(tr.vS) <= C.TRAIN_CRUSH_MIN) continue;
    // THE LATERAL OF THAT TRACK AT THIS ARC, not the one at the train's
    // centre. A car is 18 m and a full train 140, while the tracks swing
    // from the platform's bands to the bore gauge over 55 m: judged by its
    // centre, the metal that kills you sits up to twelve metres from the
    // metal you can see (from play 2026-09-07: "killed by a train I did not
    // touch"). The picture moved onto latAt already; this is the same body.
    if (Math.abs(y - tr.latAt(x)) < C.CAR_WIDTH / 2 + r * 0.3 && Math.abs(x - tr.s) < tr.len / 2 + r * 0.5)
      return true;
  }
  return false;
}
