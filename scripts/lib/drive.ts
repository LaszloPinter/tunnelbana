// Driving a run for many ticks without it stopping to ask you something.
import { CHOICE } from '../../src/sim/tick.ts';
import type { Run } from '../../src/sim/run.ts';
import { asStation } from '../../src/sim/place.ts';
import { sameFrame } from '../../src/combat/enemies.ts';
import { seatOnMap } from '../../src/world/trainSeat.ts';

/**
 * The choice to feed this tick.
 *
 * A level-up holds the whole world until the pick is answered (that is what
 * pausing for a perk means), and a probe that always sends CHOICE.none never
 * answers, so the run freezes mid-walk and every later assertion is about a
 * player who cannot move. It stayed hidden while nothing died near these
 * probes; the moment the horde could follow a walker into a tunnel, they
 * levelled and eight probes went quiet at once (2026-09-07).
 *
 * Take the first card and carry on: what the pick WAS is another probe's
 * business. Between rides, say go.
 */
export function answerPicks(sim: Run): number {
  if (sim.pause?.kind === 'ride') return CHOICE.go;
  return sim.pause ? CHOICE.card(0) : CHOICE.none;
}

/**
 * THE SCRIPTED PLAYER the gate replays: shoots whatever is nearest, dashes
 * now and then, and walks to the nearest open door when a train is standing.
 *
 * ONE copy. It was pasted into the golden dump, the replay check and the log
 * check verbatim, so a change to one quietly made the three test different
 * players. And all three steered in the OLD world's terms, a door's
 * station-local x against the walker's map x, so on the map the bot never
 * found a door and never rode: every golden line read `stops=0`, and the
 * gate's whole ride path went unexercised. The seat is asked on the map now
 * (world/trainSeat.ts), the same way the game finds it.
 */
export function bot(
  sim: Run,
  t: number,
): { held: number; mx: number; my: number; aimX: number; aimY: number } {
  const me = sim.me;
  const target = sim.here.enemies.find((x) => x.hp > 0 && sameFrame(me, x));
  const aimX = target ? target.x : me.x + 100;
  const aimY = target ? target.y : me.y;
  let held = target ? 1 : 0;
  if (t % 400 > 300) held |= 2;
  let mx = 0;
  let my = 0;
  if (me.frame.kind === 'world') {
    // the nearest open door of a train standing here, as a point on the map
    let door: { x: number; y: number } | null = null;
    let best = Infinity;
    const st = asStation(sim.here);
    if (st)
      for (let ti = 0; ti < st.rails.length; ti++) {
        const rail = st.rails[ti];
        const tr = rail.train;
        if (!rail.journey || tr.phase !== 'dwell' || !tr.doorsOpen) continue;
        for (const d of tr.doors) {
          const at = seatOnMap(st, { ti, rx: (d.x0 + d.x1) / 2, ry: 0, jid: rail.journey }, sim.gameNow);
          if (!at) continue;
          const dd = (at.x - me.x) ** 2 + (at.y - me.y) ** 2;
          if (dd < best) {
            best = dd;
            door = at;
          }
        }
      }
    if (door) {
      const dx = door.x - me.x;
      const dy = door.y - me.y;
      mx = Math.abs(dx) > 6 ? (dx > 0 ? 1 : -1) : 0;
      my = Math.abs(dy) > 6 ? (dy > 0 ? 1 : -1) : 0;
      if (!mx && !my) my = dy > 0 ? 1 : -1;
    } else {
      mx = Math.sin(t / 90) > 0 ? 1 : -1;
      if (t % 240 < 6) held |= 4;
    }
  }
  return { held, mx, my, aimX, aimY };
}
