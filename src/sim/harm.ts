import * as C from '../config.ts';
import { applyKnock, sameFrame } from '../combat/enemies.ts';
import { pushFx, ring } from '../combat/fx.ts';
import { hasTicket, withTickets } from '../core/cards.ts';
import { dist } from './det.ts';
import { dashing, maxHp, type Player } from './player.ts';
import { PINGS } from './tick.ts';
import type { Run } from './run.ts';
import { easeOf, rideDmgMul } from './chain.ts';

/**
 * What hurts a commuter, and what it means for the run: damage, going
 * down, dying, and the canned calls a downed player can still make.
 */

export function hurt(
  run: Run,
  p: Player,
  n: number,
  reason: string,
  now: number,
  srcX?: number,
  srcY?: number,
) {
  // the floor is as low as it goes: the downed take no further damage
  if (!p.alive || p.downed) return;
  // dashing grants invulnerability, you phase through the horde
  if (dashing(p, now)) return;
  const st = run.placeOf(p);
  const host = run.hostFor(st);
  void srcX;
  void srcY;
  if (now < p.iframesUntil) return;
  // the nimble perk: a hit may miss you outright, never more than half of them
  if (p.mods.dodge > 0 && run.rng() < Math.min(0.5, p.mods.dodge)) {
    pushFx(run.fx, ring(p.x, st.worldY(p.x, p.y), C.M(0.9), 0xd8f0ff, 1.8, 180, 0.6, 6.4));
    run.showMsg('Dodged!', now, p);
    p.iframesUntil = now + 250;
    return;
  }
  p.iframesUntil = now + 700;
  // every ride of the chain the horde hits harder (sim/chain.ts)
  // ...and softer on the first ride's first stops (chain.ts easeOf)
  p.health -= n * rideDmgMul(run.ride) * easeOf(run);
  run.host.feel(p.id, 'hit');
  run.showMsg(reason, now, p);
  // Panic Wave perk: getting hit may shove everything nearby away
  if (p.mods.retaliate > 0 && run.rng() < p.mods.retaliate) {
    pushFx(run.fx, ring(p.x, st.worldY(p.x, p.y), C.M(1), 0xffffff, 4, 220, 0.5, 6.4));
    for (const e of st.enemies) {
      if (e.hp <= 0 || !sameFrame(p, e)) continue;
      const d = dist(e.x - p.x, e.y - p.y);
      if (d < C.M(4)) {
        applyKnock(host, e, { x: (e.x - p.x) / (d || 1), y: (e.y - p.y) / (d || 1) }, C.M(18));
        e.stunUntil = now + 400;
      }
    }
  }
  if (p.health <= 0) die(run, p, reason);
}

/** a canned call: a ring where you stand and a line on every screen */
export function ping(run: Run, p: Player, bit: number) {
  const pg = PINGS.find((g) => g.bit === bit);
  if (!pg) return;
  pushFx(run.fx, ring(p.x, run.placeOf(p).worldY(p.x, p.y), C.M(0.8), 0xffd23f, 5, 500, 0.8, 6.8));
  run.showMsg(`P${p.id + 1}: ${pg.text}`, run.gameNow);
}

/**
 * A commuter goes down. With a teammate still standing that means DOWNED
 * (§11c): on the floor where they fell, or on the train that took them,
 * until someone kneels beside them and holds E. Only when nobody is left
 * standing does the run end.
 */
export function die(run: Run, p: Player, reason: string) {
  if (!p.alive || p.downed) return;
  const now = run.gameNow;
  const wy = run.placeOf(p).worldY(p.x, p.y);
  // RESERVKRAFT: once, you get back up, and the ticket is spent
  // (a Dubbelbiljett copying it is a second life: the copy is spent first)
  if (hasTicket(p, 'reservkraft')) {
    const slot = p.cards.indexOf('reservkraft');
    const copy = slot > 0 && p.cards[slot - 1] === 'dubbel' ? slot - 1 : -1;
    withTickets(p, (ids) => ids.splice(copy >= 0 ? copy : slot >= 0 ? slot : ids.indexOf('dubbel'), 1));
    p.health = Math.round(maxHp(p) * 0.3);
    p.iframesUntil = now + 2000;
    pushFx(run.fx, ring(p.x, wy, C.M(2), 0xffe080, 4, 500, 0.9, 6.8));
    run.showMsg(`P${p.id + 1}: Reservkraft: back on your feet. The ticket is spent.`, now);
    run.host.feel(p.id, 'hit');
    return;
  }
  const othersStanding = run.players.some((q) => q !== p && q.alive && !q.downed);
  if (othersStanding) {
    downPlayer(run, p, now);
    run.showMsg(`P${p.id + 1} is down: ${reason}`, now);
    run.host.feel(p.id, 'hit');
    return;
  }
  p.alive = false;
  p.health = 0;
  run.deaths += 1;
  run.host.feel(p.id, 'death');
  run.finishRun('died', reason);
}

export function downPlayer(run: Run, p: Player, _now: number) {
  p.downed = true;
  p.health = 0;
  p.reviveProgress = 0;
  p.castKind = 'none';
  p.jumpStart = 0;
  p.gliding = false;
  p.offer = null;
  run.deaths += 1;
  pushFx(run.fx, ring(p.x, run.placeOf(p).worldY(p.x, p.y), C.M(1.2), 0xff8080, 3, 400, 0.7, 6.5));
}

/**
 * A teammate on the floor beside you: holding E kneels and revives, and
 * takes priority over every other thing E means. Returns true when the
 * hold was spent on a revive this tick.
 */
export function tryRevive(run: Run, p: Player, dt: number, now: number): boolean {
  const downed = run.players.find(
    (q) =>
      q.alive &&
      q.downed &&
      q.placeId === p.placeId &&
      q.frame.kind === p.frame.kind &&
      dist(q.x - p.x, q.y - p.y) < C.M(1.8),
  );
  if (!downed) return false;
  downed.reviveProgress += dt * p.mods.reviveSpeed;
  downed.reviveHeldAt = now;
  if (downed.reviveProgress >= 2) {
    downed.downed = false;
    downed.reviveProgress = 0;
    downed.health = Math.round(maxHp(downed) * 0.4);
    downed.iframesUntil = now + 1500;
    pushFx(
      run.fx,
      ring(downed.x, run.placeOf(downed).worldY(downed.x, downed.y), C.M(1), 0x9fe0b5, 3, 300, 0.8, 6.5),
    );
    run.showMsg(`P${downed.id + 1} is back on their feet!`, now);
  } else if (p.id === run.localId || downed.id === run.localId) {
    run.host.hint(`Reviving P${downed.id + 1}… ${Math.round((downed.reviveProgress / 2) * 100)}%`);
  }
  return true;
}
