// Putting a probe's walker into a tunnel, now that the world is one map: build
// the leg, stand the player at a point of its curve, and point the run at it.
// One helper, so no probe has to know how a leg's arc becomes a place.
import type { Corridor } from '../../src/core/corridor.ts';
import type { Leg } from '../../src/sim/legPlace.ts';
import type { Player } from '../../src/sim/player.ts';
import type { Run } from '../../src/sim/run.ts';
import { fromLeg } from '../../src/world/floor.ts';

/** stand `p` a fraction of the way along `c`, on the bore's centreline */
export function putInLeg(sim: Run, p: Player, c: Corridor, frac = 0.5, t = 0): Leg {
  return putInLegAt(sim, p, c, c.s0 + (c.s1 - c.s0) * frac, t);
}

/** ...and at an exact arc/lateral, for probes that pick their own spot */
export function putInLegAt(sim: Run, p: Player, c: Corridor, s: number, t = 0): Leg {
  const leg = sim.ensureLeg(c);
  const at = fromLeg(leg, s, t);
  p.x = at.x;
  p.y = at.y;
  p.placeId = leg.id;
  p.frame = { kind: 'world' };
  sim.hereId = leg.id;
  return leg;
}
