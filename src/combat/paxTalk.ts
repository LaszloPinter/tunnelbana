import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { airborne, manaMax, maxHp, nearestPlayer, type Player } from '../sim/player.ts';
import { sayLine, type Passenger } from '../sim/passenger.ts';
import type { Run } from '../sim/run.ts';
import type { CombatHost, Enemy } from './types.ts';

/**
 * PASSENGERS TALK (DESIGN §20): a greeting when you come near, a remark now
 * and then while you are in sight, a cry when they are bitten, thanks, and
 * a few kronor, when you kill what was biting them, and some ask you for a
 * tenner (E gives it; they give you something back). All of it simulation:
 * the line is chosen from the passenger's own stream, and money changes
 * hands, so every client hears and pays the same.
 */
export const TENNER = 10;

/**
 * each tick, for a passenger on foot where the party is. SWEDES ARE
 * RESERVED (the user's call, 2026-10-11): only the chatty few greet you or
 * remark on anything; most manage a nod, if that. What gets EVERYONE to
 * speak is the personal space of a Stockholmer, you dashing past them, or
 * standing right up against them, and somebody asking for a tenner.
 */
export function stepTalk(ctx: CombatHost, ps: Passenger, now: number) {
  const run = ctx.run as unknown as Run;
  const p = nearestPlayer(ctx.players, ps.x, ps.y);
  const dp = p ? dist(p.x - ps.x, p.y - ps.y) : Infinity;
  const quiet = now - ps.sayAt;
  if (ps.nextChatAt === 0) ps.nextChatAt = now + 8_000 + run.contentRng(`chat0:${ps.id}`)() * 30_000;
  // PERSONAL SPACE: everyone has a line for this
  if (p && dp < C.M(1.6) && airborne(p, now) && quiet > 6_000) {
    if (run.contentRng(`dash:${ps.id}:${ps.lines}`)() < 0.4) sayLine(run, ps, 'space', now);
    else ps.sayAt = now;
    return;
  }
  if (p && dp < C.M(1.1)) {
    if (ps.closeSince === 0) ps.closeSince = now;
    if (now - ps.closeSince > 3_000 && quiet > 10_000) {
      sayLine(run, ps, 'space', now);
      return;
    }
  } else ps.closeSince = 0;
  if (ps.asks && !ps.given && dp < C.M(3) && now - ps.askedAt > 9_000) {
    ps.askedAt = now;
    ps.greeted = true;
    sayLine(run, ps, 'ask', now);
    return;
  }
  if (!ps.greeted && dp < C.M(4)) {
    ps.greeted = true;
    if (ps.chatty) sayLine(run, ps, 'greet', now);
    else if (run.contentRng(`nod:${ps.id}`)() < 0.2) sayLine(run, ps, 'nod', now);
    return;
  }
  if (now >= ps.nextChatAt) {
    const rng = run.contentRng(`chat:${ps.id}:${ps.lines}`);
    ps.nextChatAt = now + 30_000 + rng() * 40_000;
    if (ps.chatty && dp < C.M(14) && quiet > 5_000)
      sayLine(run, ps, ps.dest && rng() < 0.25 ? 'dest' : 'chat', now);
  }
}

/**
 * A SEAT KILLED SOMETHING RIGHT BY THEM: now and then somebody says so,
 * the chatty more often, and never over a rescue (paxSaved does that).
 */
export function paxCheer(ctx: CombatHost, e: Enemy, now: number) {
  const run = ctx.run as unknown as Run;
  for (const ps of run.pax) {
    if (!ps.alive || ps.mode === 'aboard' || ps.placeId !== ctx.st.id) continue;
    if (now - ps.sayAt < 8_000 || dist(e.x - ps.x, e.y - ps.y) > C.M(5)) continue;
    if (run.contentRng(`cheer:${ps.id}:${e.id}`)() < (ps.chatty ? 0.3 : 0.08)) sayLine(run, ps, 'cheer', now);
  }
}

/**
 * A RESCUE: a seat killed something right beside a passenger it had been
 * biting. They say so, and press a few kronor on whoever did it.
 */
export function paxSaved(ctx: CombatHost, e: Enemy, killer: Player, now: number) {
  const run = ctx.run as unknown as Run;
  for (const ps of run.pax) {
    if (!ps.alive || ps.mode === 'aboard' || ps.placeId !== ctx.st.id) continue;
    if (now - ps.hurtAt > 5_000 || dist(e.x - ps.x, e.y - ps.y) > C.M(3.5)) continue;
    ps.hurtAt = -1e9;
    sayLine(run, ps, 'thanks', now);
    const tip = 5 + Math.floor(run.contentRng(`tip:${ps.id}:${ps.lines}`)() * 16);
    killer.money += tip;
    ctx.showMsg(`${tip} kr: a thank-you`, now, killer);
  }
}

/** E beside somebody asking for a tenner: give it, and get something back. True if it was this */
export function giveToPassenger(run: Run, p: Player, now: number): boolean {
  let who: Passenger | null = null;
  let bd = C.M(2.4);
  for (const ps of run.pax) {
    if (!ps.alive || !ps.asks || ps.given || ps.mode === 'aboard' || ps.placeId !== p.placeId) continue;
    const d = dist(ps.x - p.x, ps.y - p.y);
    if (d < bd) {
      bd = d;
      who = ps;
    }
  }
  if (!who) return false;
  if (p.money < TENNER) {
    run.showMsg(`You do not have ${TENNER} kr to give.`, now, p);
    return true;
  }
  p.money -= TENNER;
  who.given = true;
  sayLine(run, who, 'gift', now);
  // what they press into your hand: a little mana, or a little patching up
  if (run.contentRng(`gift:${who.id}`)() < 0.5) {
    p.mana = Math.min(manaMax(run.party, p), p.mana + 25);
    run.showMsg(`−${TENNER} kr · +25 mana: they had a spare energy drink`, now, p);
  } else {
    p.health = Math.min(maxHp(p), p.health + 20);
    run.showMsg(`−${TENNER} kr · +20 HP: they had plasters`, now, p);
  }
  return true;
}

/** is somebody beside this seat asking for a tenner? (the HUD's E hint) */
export function askerNear(run: Run, p: Player): boolean {
  return run.pax.some(
    (ps) =>
      ps.alive &&
      ps.asks &&
      !ps.given &&
      ps.mode !== 'aboard' &&
      ps.placeId === p.placeId &&
      dist(ps.x - p.x, ps.y - p.y) < C.M(2.4),
  );
}
