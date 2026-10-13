import { ticketCount } from '../core/cards.ts';
import type { CombatHost } from './types.ts';
import { asStation } from '../sim/place.ts';

/** a train toward the destination left without the party, after the station was cleared */
export function onTrainMissedAfterClearing(ctx: CombatHost, now: number) {
  const st = asStation(ctx.st);
  if (!st) return;
  // YOU CANNOT MISS A TRAIN YOU ARE NOT WAITING FOR.
  //
  // This fired on every departure once a station was cleared, whoever was
  // where, so walking the tunnel to the next station (§11b-ii, a legitimate
  // way to travel) had the platform behind you announcing that the dark was
  // coming for you, two stops from anywhere, and then actually ADVANCING it
  // past two missed trains. The messages were being written to somebody who
  // had already left.
  const waiting = ctx.run.players.some((p) => p.alive && p.frame.kind === 'world' && !st.inTunnelX(p.x));
  if (!waiting) return;
  st.missedTrains += 1;
  // Återbäring: the train you let go pays you
  for (const q of ctx.run.players) {
    const pay = 60 * ticketCount(q, 'aterbaring');
    if (q.alive && pay > 0) {
      q.money += pay;
      ctx.showMsg(`Återbäring: +${pay} kr`, now, q);
    }
  }
  if (st.missedTrains === 1) ctx.showMsg('The train leaves without you. One more and the dark comes.', now);
  else if (st.missedTrains === 2)
    ctx.showMsg('The dark is coming. Take the NEXT train: board at the centre.', now);
  else ctx.showMsg('The dark has the platform.', now);
}
