import * as C from '../config.ts';
import type { Run } from '../sim/run.ts';

/** how far a phone's casts reach for something to hit */
export const AUTO_AIM_RANGE = C.M(14);

/**
 * WHAT A PHONE AIMS AT: the nearest of the horde within reach, on the same
 * footing as the caster (on the floor, or in the same train). Read from the
 * run once a frame, into the input like a cursor would be, so it is logged
 * and replayed like any aim; the simulation never learns it was automatic.
 */
export function autoAimTarget(sim: Run): { x: number; y: number } | null {
  const me = sim.me;
  if (!me.alive || me.downed || me.offer) return null;
  const myJid = me.frame.kind === 'aboard' ? me.frame.jid : undefined;
  let best: { x: number; y: number } | null = null;
  let bd = AUTO_AIM_RANGE;
  for (const id of sim.live) {
    const pl = sim.places.get(id);
    if (!pl) continue;
    for (const e of pl.enemies) {
      if (e.hp <= 0) continue;
      // the same footing: a vätte on a train you are not on is behind glass
      const ej = e.frame.kind === 'aboard' ? e.frame.jid : undefined;
      if (e.frame.kind !== me.frame.kind || (myJid && ej && ej !== myJid)) continue;
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      if (d < bd) {
        bd = d;
        best = { x: e.x, y: e.y };
      }
    }
  }
  return best;
}
