import * as C from '../config.ts';
import type { CombatHost } from './types.ts';
import { dist } from '../sim/det.ts';
import { manaMax, nearestPlayer } from '../sim/player.ts';
import { ticketCount } from '../core/cards.ts';
import { aboardPoint } from '../world/trainSeat.ts';

/**
 * Coins and lost-property drops: they follow their train, they expire, and
 * they are picked up by walking over them, by whoever gets there, and when
 * two are standing on one coin, by the nearer (then the lower seat), which is
 * a rule four clients agree on.
 *
 * Nothing here draws. A drop is a position in a frame plus a colour and a
 * radius; `GroundView` finds where that frame is and puts a circle there.
 */

/**
 * WHERE A DROP ACTUALLY IS. A coin on the floor is already a place on the
 * map; one aboard a train is a SEAT on a journey, and the car it is lying in
 * carries it (world/trainSeat.ts). The old world could add the car's own x to
 * a room's left edge because a train lived inside one room's chart.
 */
function lootAt(
  ctx: CombatHost,
  it: { frame: 'world' | 'train'; ti: number; x: number; y: number; jid?: string },
  rail: { train: { x: number } } | undefined,
): { x: number; y: number } {
  const seat = it.jid ? aboardPoint(it.jid, it.x, it.y, ctx.run.gameNow) : null;
  if (seat) return seat;
  return rail ? { x: rail.train.x + it.x, y: it.y } : { x: it.x, y: it.y };
}

export function stepLoot(ctx: CombatHost, now: number) {
  ctx.st.coins = ctx.st.coins.filter((c) => {
    const rail = c.frame === 'train' ? ctx.st.rails[c.ti] : undefined;
    // its car is gone, and so is it
    if (c.frame === 'train' && !rail) return false;
    if (now > c.expireAt) return false;
    const at = lootAt(ctx, c, rail);
    let wx = at.x;
    let wy = at.y;
    // the Magnet ticket: a coin on the floor drifts toward whoever holds one
    if (!rail) {
      const m = nearestPlayer(
        ctx.players,
        wx,
        wy,
        (q) => q.frame.kind === 'world' && dist(q.x - wx, q.y - wy) < C.M(6) * ticketCount(q, 'magnet'),
      );
      if (m) {
        const d = dist(m.x - wx, m.y - wy) || 1;
        const step = Math.min(d, C.M(7) / 60);
        c.x += ((m.x - wx) / d) * step;
        c.y += ((m.y - wy) / d) * step;
        wx = c.x;
        wy = c.y;
      }
    }
    // EVERY SEAT IN THE RUN, not the ones filed here: a rider is filed at
    // the station until arrival, and the coins a train crushes out of the
    // horde lie in the tunnel's list, so nobody was ever "here" to pick
    // them up as the train ran over them (from play 2026-09-21)
    const p = nearestPlayer(ctx.run.players, wx, wy, (q) => dist(q.x - wx, q.y - wy) < q.r + C.M(1.3));
    if (p) {
      // income is shared, capital is not (§16): a coin anyone picks up goes
      // into every wallet; what is spent comes out of one
      // Reskassa: the holder's share is bigger
      for (const q of ctx.run.players)
        if (q.alive) q.money += Math.round((c.value ?? 5) * (1 + 0.4 * ticketCount(q, 'reskassa')));
      return false;
    }
    return true;
  });
  ctx.st.pickups = ctx.st.pickups.filter((pk) => {
    const rail = pk.frame === 'train' ? ctx.st.rails[pk.ti] : undefined;
    if (pk.frame === 'train' && !rail) return false;
    if (now > pk.expireAt) return false;
    const at = lootAt(ctx, pk, rail);
    let wx = at.x;
    let wy = at.y;
    // the Magnet ticket pulls mana orbs too
    if (!rail) {
      const m = nearestPlayer(
        ctx.players,
        wx,
        wy,
        (q) => q.frame.kind === 'world' && dist(q.x - wx, q.y - wy) < C.M(6) * ticketCount(q, 'magnet'),
      );
      if (m) {
        const d = dist(m.x - wx, m.y - wy) || 1;
        const step = Math.min(d, C.M(7) / 60);
        pk.x += ((m.x - wx) / d) * step;
        pk.y += ((m.y - wy) / d) * step;
        wx = pk.x;
        wy = pk.y;
      }
    }
    const p = nearestPlayer(ctx.players, wx, wy, (q) => dist(q.x - wx, q.y - wy) < q.r + C.M(1));
    if (p) {
      if (pk.kind === 'card') {
        // the king's hoard, shared (the black card is out until it has its idea)
        for (const q of ctx.run.players)
          if (q.alive) q.money += Math.round(300 * (1 + 0.4 * ticketCount(q, 'reskassa')));
        ctx.showMsg("The king's hoard is shared: +300 kr", now);
        return false;
      }
      p.mana = Math.min(manaMax(ctx.run.party, p), p.mana + 9);
      ctx.showMsg('+9 mana', now, p);
      return false;
    }
    return true;
  });
}
