import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { stepBody } from '../world/body2d.ts';
import { PAX_KINDS, type Passenger } from '../sim/passenger.ts';
import type { Run } from '../sim/run.ts';
import { asStation } from '../sim/place.ts';
import { isOccupied } from '../sim/places.ts';
import { nearestPlayer } from '../sim/player.ts';
import { islandOf, paxFlow, railsOfIsland } from '../sim/paxSpawn.ts';
import type { CombatHost, Enemy } from './types.ts';
import { boardIfAtDoor, nearestWayOut, paxArrivals, PATIENCE_MS, trainToBoard } from './paxRide.ts';
import { strike, throwAt, tryHeal } from './paxFight.ts';
import { stepAboardPax } from './paxAboard.ts';
import { clearSpot } from '../world/walk2d.ts';
import { fromPlatform, onPlatform } from '../world/floor.ts';
import { stepTalk } from './paxTalk.ts';
import { idle } from './paxIdle.ts';

/**
 * WHAT PASSENGERS DO, each tick (DESIGN §20), ONLY WHERE THE PARTY IS. The
 * whole network is live, and a station nobody stands in still runs its
 * horde: its people were fought to death before anyone arrived (from play
 * 2026-10-10). Elsewhere they stand still, and nothing goes after them.
 *
 * THE INSTINCTS, in order, what a person on a platform at night would do:
 *   1. their train is standing open: they go for it (nothing but a bite in
 *      the face stops them), and sit
 *   2. a nurse patches up whoever near her is hurt
 *   3. fight or flight: the fighters (a guard's baton, a teenager's
 *      smällare) take on the horde only while they are well and not
 *      outnumbered; everyone else, and the fighters when it turns, falls
 *      back, toward the player if one is near, the safest place on the
 *      platform, and only lashes out at what has cornered them
 *   4. their purpose: hold the post, wait by the track, or walk out
 */
export function stepPassengers(run: Run, dt: number, now: number) {
  paxArrivals(run, now);
  for (const id of run.live) {
    const st = asStation(run.places.get(id));
    if (st && isOccupied(run, st)) paxFlow(run, st, now);
  }
  for (const ps of [...run.pax]) {
    if (!ps.alive || !run.live.has(ps.placeId)) continue;
    if (ps.mode === 'aboard') {
      stepAboardPax(run, ps, dt, now);
      continue;
    }
    const place = run.places.get(ps.placeId);
    if (!place || !isOccupied(run, place)) continue;
    const ctx = run.hostFor(place);
    stepTalk(ctx, ps, now);
    act(ctx, run, ps, dt, now);
  }
  // the gone are gone: up the escalator, off on a train, or killed
  for (let i = run.pax.length - 1; i >= 0; i--) if (!run.pax[i].alive) run.pax.splice(i, 1);
}

interface Threat {
  near: Enemy | null;
  d: number;
  /** how many of the horde within five metres */
  crowd: number;
}

function sizeUp(ctx: CombatHost, ps: Passenger): Threat {
  let near: Enemy | null = null;
  let d = Infinity;
  let crowd = 0;
  for (const e of ctx.st.enemies) {
    if (e.hp <= 0 || e.frame.kind !== 'world') continue;
    const de = dist(e.x - ps.x, e.y - ps.y);
    if (de < C.M(5)) crowd += 1;
    if (de < d) {
      d = de;
      near = e;
    }
  }
  return { near, d, crowd };
}

function act(ctx: CombatHost, run: Run, ps: Passenger, dt: number, now: number) {
  const k = PAX_KINDS[ps.kind];
  // OFF THE TRACKS, FIRST AND ALWAYS. Nobody means to stand on the bed; one
  // who is there (the doors shut on them, a shove) climbs straight back up,
  // as a body that may leave the ground, since a platform edge is a step
  // nobody walks up (from play 2026-10-11: "standing on the tracks")
  if (ctx.run.map.at(ps.x, ps.y, ps.placeId)?.kind === 'bed') {
    const up = clearSpot(run, ps.x, ps.y, ps.r, 'platform');
    ps.x = up.x;
    ps.y = up.y;
    return;
  }
  const t = sizeUp(ctx, ps);
  const bitten = !!t.near && t.d < ps.r + t.near.r + C.M(0.4);

  // 1. THEIR TRAIN, standing open
  if (ps.plan === 'catch' && !bitten) {
    const door = trainToBoard(run, ps, now);
    if (door) {
      if (!boardIfAtDoor(run, ps, door)) walkToward(ctx, ps, door.x, door.y, dt, 1.15);
      return;
    }
  }
  // 2. a nurse patches people up
  if (k.role === 'healer') tryHeal(ctx, ps, now);

  // 3. FIGHT OR FLIGHT
  if (t.near && t.d < C.M(7)) {
    const fit = ps.hp > ps.maxHp * 0.45 && t.crowd <= k.odds;
    const homeOk = ps.plan !== 'post' || dist(t.near.x - ps.homeX, t.near.y - ps.homeY) < C.M(9);
    if (k.role === 'melee' && fit && homeOk) {
      if (t.d < ps.r + t.near.r + k.reach) strike(ctx, ps, t.near, now);
      else walkToward(ctx, ps, t.near.x, t.near.y, dt, k.pace);
      return;
    }
    if (k.role === 'ranged' && fit) {
      // keep a throw's distance: back off when it closes, step in when it is out of range
      if (t.d < C.M(3.5)) fallBack(ctx, ps, t.near, dt, k.pace);
      else if (t.d <= k.reach) throwAt(ctx, ps, t.near, now);
      else walkToward(ctx, ps, t.near.x, t.near.y, dt, k.pace);
      return;
    }
    if (t.d < C.M(5) || !fit) {
      if (bitten) strike(ctx, ps, t.near, now);
      fallBack(ctx, ps, t.near, dt, Math.max(1.1, k.pace));
      return;
    }
  }

  // 4. THEIR PURPOSE
  if (ps.plan === 'catch' && now - ps.since > PATIENCE_MS) ps.plan = 'exit';
  if (ps.plan === 'exit') {
    const st = asStation(ctx.st);
    const out = st ? nearestWayOut(st, ps) : null;
    if (!out) {
      // no escalator on their island: they leave by train instead
      const rails = st ? railsOfIsland(st, islandOf(st, ps.x, ps.y)) : [];
      if (rails.length > 0) {
        ps.plan = 'catch';
        ps.waitTi = rails[0];
        ps.want = '';
        ps.since = now;
      }
      return;
    }
    // up the escalator and gone
    if (dist(out.x - ps.x, out.y - ps.y) < C.M(1.4)) ps.alive = false;
    else walkToward(ctx, ps, out.x, out.y, dt, k.pace * 0.85);
    return;
  }
  // waiting, they shift about (combat/paxIdle.ts), at a stroll, unless far off
  const st = asStation(ctx.st);
  if (st) idle(run, st, ps, now);
  const far = dist(ps.homeX - ps.x, ps.homeY - ps.y);
  if (far > C.M(0.6)) walkToward(ctx, ps, ps.homeX, ps.homeY, dt, k.pace * (far > C.M(10) ? 0.85 : 0.5));
}

/**
 * FALLING BACK: toward the nearest seat if one is within fifteen metres,
 * the safest place on a platform is behind the person with the magic, and
 * straight away from the threat otherwise.
 */
function fallBack(ctx: CombatHost, ps: Passenger, foe: Enemy, dt: number, pace: number) {
  const p = nearestPlayer(ctx.players, ps.x, ps.y);
  // ...but not INTO the horde: a player standing in it is no shelter
  const besieged =
    !!p &&
    ctx.st.enemies.some((e) => e.hp > 0 && e.frame.kind === 'world' && dist(e.x - p.x, e.y - p.y) < C.M(3));
  if (p && !besieged && dist(p.x - ps.x, p.y - ps.y) < C.M(15)) {
    // to the far side of the seat from the threat, a couple of metres off
    const dx = p.x - foe.x;
    const dy = p.y - foe.y;
    const d = dist(dx, dy) || 1;
    const tx = p.x + (dx / d) * C.M(2.2);
    const ty = p.y + (dy / d) * C.M(2.2);
    if (dist(tx - ps.x, ty - ps.y) > C.M(0.8)) {
      walkToward(ctx, ps, tx, ty, dt, pace);
      return;
    }
  }
  // AWAY ALONG THE PLATFORM, down the middle of their island, away across
  // it is straight at the edge, where they stood pressed against the tracks
  // for as long as the horde stayed (from play 2026-10-11)
  const st = asStation(ctx.st);
  const me = st ? onPlatform(st, ps.x, ps.y) : null;
  const it = st ? onPlatform(st, foe.x, foe.y) : null;
  const isl =
    st && me ? st.platforms.find((pf) => me.y >= pf.top - C.M(1) && me.y <= pf.bottom + C.M(1)) : undefined;
  if (st && me && it && isl) {
    const run = me.x >= it.x ? 1 : -1;
    const to = fromPlatform(st, me.x + run * C.M(6), (isl.top + isl.bottom) / 2);
    walkToward(ctx, ps, to.x, to.y, dt, pace);
    return;
  }
  walkToward(ctx, ps, ps.x + (ps.x - foe.x), ps.y + (ps.y - foe.y), dt, pace);
}

/** a step toward a point, held by the world like anyone else's */
function walkToward(
  ctx: CombatHost,
  ps: Passenger,
  tx: number,
  ty: number,
  dt: number,
  pace: number,
  climb = false,
) {
  const d = dist(tx - ps.x, ty - ps.y);
  if (d < C.M(0.3)) return;
  const step = Math.min(d, C.PLAYER_SPEED * pace * dt);
  const moved = stepBody(
    ctx.run,
    ctx.run.map,
    ps.x,
    ps.y,
    ((tx - ps.x) / d) * step,
    ((ty - ps.y) / d) * step,
    ps.r,
    true,
    climb,
    ps.slide,
  );
  // NEVER OFF THE EDGE: a step from the platform onto the bed is refused,
  // whatever it was for, fleeing to the far side of a player who stands by
  // the edge put commuters on the tracks (from play 2026-10-11). What is
  // left is the step ALONG the edge, in the platform's own frame: split in
  // map axes it froze them at the edge of any platform not lying square
  // to the map, which is most of them.
  const map = ctx.run.map;
  const onDeck = (x: number, y: number) => map.at(x, y, ps.placeId)?.kind !== 'bed';
  const st = asStation(ctx.st);
  const before = { x: ps.x, y: ps.y };
  if (!climb && onDeck(ps.x, ps.y) && !onDeck(moved.x, moved.y)) {
    const a = st ? onPlatform(st, ps.x, ps.y) : null;
    const b = st ? onPlatform(st, moved.x, moved.y) : null;
    const along = st && a && b ? fromPlatform(st, b.x, a.y) : null;
    if (along && onDeck(along.x, along.y)) {
      ps.x = along.x;
      ps.y = along.y;
    }
  } else {
    ps.x = moved.x;
    ps.y = moved.y;
  }
  ps.slide = moved.turn;
  // STUCK, meaning to go somewhere and getting nowhere for three seconds:
  // a step toward the middle of their island, out of whatever corner holds them
  if (dist(ps.x - before.x, ps.y - before.y) < step * 0.1) {
    if (ps.stuckSince === 0) ps.stuckSince = ctx.run.gameNow;
    else if (st && ctx.run.gameNow - ps.stuckSince > 3_000) {
      const l = onPlatform(st, ps.x, ps.y);
      const isl = l
        ? st.platforms.find((pf) => l.y >= pf.top - C.M(1) && l.y <= pf.bottom + C.M(1))
        : undefined;
      if (l && isl) {
        const mid = fromPlatform(st, l.x, (isl.top + isl.bottom) / 2);
        const dm = dist(mid.x - ps.x, mid.y - ps.y) || 1;
        const k = Math.min(1, C.M(0.5) / dm);
        ps.x += (mid.x - ps.x) * k;
        ps.y += (mid.y - ps.y) * k;
      }
      ps.stuckSince = 0;
    }
  } else ps.stuckSince = 0;
  // whichever room they stand in now owns them: a lookup, not a crossing
  const on = ctx.run.map.at(ps.x, ps.y, ps.placeId);
  if (on) ps.placeId = on.place.id;
}
