import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import { rollEnemyType, spawnEnemy } from './enemies.ts';
import { activePlayers, alivePlayers } from '../sim/player.ts';
import { ENEMY_R, type CombatHost } from './types.ts';
import { asStation } from '../sim/place.ts';
import type { Station } from '../sim/station.ts';
import { rideCountMul } from '../sim/chain.ts';
// the station's quieter moments, in their own files; re-exported so nothing moves
export { onTrainMissedAfterClearing } from './missedTrain.ts';
export { keepDummies } from './dummies.ts';

/**
 * A station is a fixed number of waves, and then it is CLEARED (§16).
 *
 * The spawner used to run forever, and the only pressure to leave was the
 * escalation curve, which meant a platform was also a farm. Now a station
 * has `waveTotal` waves: the first comes with you off the train (or is
 * waiting when the run starts), the next comes a breath after the last of
 * the previous one dies, and when the last wave is down the station is
 * cleared, the spawner stops, the kiosk lights up, and what was dropped can
 * be picked up in peace.
 *
 * Peace with a clock on it. Clearing is not a licence to stay: two trains
 * TOWARD THE DESTINATION may leave without you; when the second has gone the
 * creeping dark comes in from both ends and keeps coming until it has the
 * whole platform. Take the third train, at the centre, because the ends go
 * first, or it consumes you. There are no new waves after clearing, ever,
 * because new waves would be a farm again; the dark is the clock and nothing
 * else is.
 */

/** how many waves a station holds; T-Centralen holds something larger (§16: a boss, later) */
/**
 * WAVES ARE A PLATFORM'S. A leg has no escalators for a horde to come down
 * and no board to miss a train from, its own answer is the ambush that
 * springs once (sim/tunnelEvents.ts). This is the station half of a host
 * (sim/place.ts), and everything here goes through it.
 */
function stationOf(ctx: CombatHost): Station | null {
  return asStation(ctx.st);
}

export function wavesFor(station: string, ride = 0): number {
  return (station === 'T-Centralen' ? 4 : 3) + Math.min(3, ride);
}

/**
 * Four players sheltering behind one ward are more than four players, so the
 * horde scales past linear in count and under linear in toughness (§16).
 */
export const partyCountMul = (n: number): number => 1 + 0.6 * (n - 1);
export const partyHpMul = (n: number): number => 1 + 0.35 * (n - 1);

/**
 * The horde's size for wave `wave` here and now.
 *
 * Tuned to a TARGET, not a feel (from play, 2026-08-24): the first station's
 * three waves plus its scatter should carry roughly the xp that brings a solo
 * party to LEVEL 5, the class moment, as the station clears. That is ~48 xp
 * of mostly-runners, so the first station deals about 45 bodies; later
 * stations grow from there with time and stops as before.
 */
function waveSize(ctx: CombatHost, wave: number): number {
  const st = stationOf(ctx);
  if (!st) return 0;
  const t = (ctx.run.gameNow - ctx.run.runStart) / 1000;
  const base = Math.min(11 + Math.floor(t / 45) + Math.floor(ctx.run.stopsTraveled * 0.8), 20);
  const later = 1 + (wave - 1) * 0.3;
  // every ride of the chain the waves grow (sim/chain.ts)
  return Math.round(
    base * later * rideCountMul(ctx.run.ride) * partyCountMul(alivePlayers(ctx.run.players).length),
  );
}

/**
 * Where a wave comes from: the escalators on the island the party is
 * standing on. The first version used every escalator at the station, so
 * at a two-island stop half the wave arrived on the far side of the tracks,
 * behind a standing train, and the last one had to be hunted down across
 * the whole station before the next wave would come. A wave is for you; it
 * comes up your stairs.
 */
function waveEscalators(ctx: CombatHost): { x: number; y: number }[] {
  const st = stationOf(ctx);
  if (!st) return [];
  const party = alivePlayers(ctx.players);
  const here = party.find((p) => p.frame.kind === 'world');
  let island = here ? st.platformAt(here.y) : -1;
  if (island < 0) {
    // still aboard: the island the ridden train's doors open onto
    const rider = party.find((p) => p.frame.kind !== 'world');
    const ti = rider && rider.frame.kind !== 'world' ? rider.frame.ti : -1;
    island = st.platforms.findIndex((pf) => pf.railTop === ti || pf.railBottom === ti);
  }
  const mine = island >= 0 ? st.escalators.filter((e) => st.platformAt(e.y) === island) : [];
  const pool = mine.length > 0 ? mine : st.escalators;
  // ...but never the stairs somebody is standing on. Arriving on foot put
  // the walker 2 m from the escalator the wave came up, five vättar inside
  // three metres before they could take a step (measured 2026-08-28).
  const clear = pool.filter((e) => party.every((p) => dist(p.x - e.x, p.y - e.y) > C.M(12)));
  return clear.length > 0 ? clear : pool;
}

/**
 * Never hatch a vätte inside a column (from play: they spawned ON pillars and
 * stood there stuck). Nudge outward in a small spiral until the floor is free.
 */
function safeSpot(ctx: CombatHost, x: number, y: number, r: number): { x: number; y: number } {
  const st = stationOf(ctx);
  if (!st) return { x, y };
  if (!st.pillarAt(x, y, r)) return { x, y };
  for (let step = C.M(1); step <= C.M(8); step += C.M(1)) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      const nx = x + dx * step;
      const ny = y + dy * step;
      if (!st.pillarAt(nx, ny, r)) return { x: nx, y: ny };
    }
  }
  return { x, y: y + C.M(2) };
}

/** the station you just arrived at: its waves start over, and the first is already here */
export function beginStationWaves(ctx: CombatHost, now: number) {
  const st = stationOf(ctx);
  // a storey with no island has no floor to put a wave on
  if (!st || st.platforms.length === 0) return;
  // the tutorial: no waves, and the station counts as cleared from the
  // first tick, so the kiosk and the machines answer as they would
  if (ctx.run.tutorial) {
    st.waveTotal = 0;
    st.wave = 0;
    st.nextWaveAt = 0;
    st.cleared = true;
    return;
  }
  st.waveTotal = wavesFor(st.name, ctx.run.ride);
  st.wave = 0;
  st.nextWaveAt = 0;
  st.cleared = false;
  st.missedTrains = 0;
  st.corruption = 0;
  // the platform is INHABITED when you get there (from play): a scatter of
  // vättar already on the floor, awake, spread across the island, so the
  // fight starts everywhere at once instead of filing down one stair
  const t = (now - ctx.run.runStart) / 1000;
  const scatter = Math.round(
    (4 + Math.floor(ctx.run.stopsTraveled * 0.5)) *
      rideCountMul(ctx.run.ride) *
      partyCountMul(alivePlayers(ctx.run.players).length),
  );
  const hpMul = partyHpMul(alivePlayers(ctx.run.players).length);
  const island = st.platforms[0];
  // the station's OWN stream: who is on this floor is a function of the run
  // seed and the station, not of what happened on the way here
  const rng = ctx.run.contentRng(`scatter:${st.name}`);
  for (let i = 0; i < scatter && st.enemies.length < 55; i++) {
    const sx = st.platformX0 + C.M(8) + rng() * (st.platformX1 - st.platformX0 - C.M(16));
    const sy = island.top + C.M(1.5) + rng() * (island.bottom - island.top - C.M(3));
    const spot = safeSpot(ctx, sx, sy, ENEMY_R + 2);
    spawnEnemy(ctx, rollEnemyType(ctx, t, 0, rng), { kind: 'world' }, spot.x, spot.y, true, 0, 1, hpMul, rng);
  }
  spawnWave(ctx, now);
}

export function spawnWave(ctx: CombatHost, now: number, arrivedByTrain = false) {
  if (ctx.run.tutorial) return;
  const st = stationOf(ctx);
  if (!st) return;
  st.wave += 1;
  st.nextWaveAt = 0;
  st.waveStartedAt = now;
  const t = (now - ctx.run.runStart) / 1000;
  const n = waveSize(ctx, st.wave);
  st.waveSize = n;
  const hpMul = partyHpMul(alivePlayers(ctx.run.players).length);
  const stairs = waveEscalators(ctx);
  // this wave's own stream (sim/det.ts seedOf): the same seed sends the same
  // wave up the same stairs, however the fight before it went
  const rng = ctx.run.contentRng(`wave:${st.name}:${st.wave}`);
  for (let i = 0; i < n && st.enemies.length < 55; i++) {
    const esc = stairs[i % stairs.length];
    // a pinch of spit from the second wave on, whatever the hour
    const type = rollEnemyType(ctx, t, arrivedByTrain ? 0.3 : st.wave >= 2 ? 0.15 : t > 45 ? 0.22 : 0, rng);
    // a wave is AWAKE: it comes for you the moment it is up the stairs.
    // Idle spawns meant running the length of the platform to wake the last
    // two, which is a chore, not a fight.
    const spot = safeSpot(ctx, esc.x + (rng() - 0.5) * C.M(3), esc.y - rng() * C.M(2), ENEMY_R + 2);
    spawnEnemy(ctx, type, { kind: 'world' }, spot.x, spot.y, true, 0, 1, hpMul, rng);
  }
  // the first station's last wave brings one troll, the first real problem,
  // timed to land just before the class moment
  if (ctx.run.stopsTraveled === 0 && st.wave === st.waveTotal && st.name !== 'T-Centralen') {
    const cx = (st.platformX0 + st.platformX1) / 2;
    const gy = (st.platforms[0].top + st.platforms[0].bottom) / 2;
    spawnEnemy(
      ctx,
      'troll',
      { kind: 'world' },
      cx,
      gy,
      true,
      0,
      1,
      partyHpMul(alivePlayers(ctx.run.players).length),
      rng,
    );
  }
  // THE MID-BOSS (decided in chat 2026-08-25): from the second stop, a
  // station's last wave brings a cacodaemon, a stalker that only ever
  // lunges, with a station's worth of hp. Not at T-Centralen, which has
  // its king.
  if (
    (ctx.run.stopsTraveled >= 2 || ctx.run.ride >= 1) &&
    st.wave === st.waveTotal &&
    st.name !== 'T-Centralen'
  ) {
    const cx = (st.platformX0 + st.platformX1) / 2;
    const gy = (st.platforms[0].top + st.platforms[0].bottom) / 2;
    const side = rng() < 0.5 ? -1 : 1;
    // clear of the column row (from play: it hatched inside a column and stood there)
    const spot = safeSpot(ctx, cx + side * C.M(18), gy + C.M(2.5), C.M(1.4) + 4);
    spawnEnemy(ctx, 'daemon', { kind: 'world' }, spot.x, spot.y, true, 0, 1, hpMul, rng);
    ctx.showMsg('Something is grinning in the dark…', now);
  }
  // T-Centralen is held by something old and large, and RULED by something
  // older. The last wave is BERGAKUNGEN himself (§16): skippable, as any wave
  // is, by taking a train; felling him is what clearing T-Centralen means.
  if (st.name === 'T-Centralen') {
    const cx = (st.platformX0 + st.platformX1) / 2;
    const gy = (st.platforms[0].top + st.platforms[0].bottom) / 2;
    if (st.wave === 1) {
      spawnEnemy(ctx, 'spider', { kind: 'world' }, cx, gy, false, 0, 1, hpMul, rng);
      spawnEnemy(ctx, 'troll', { kind: 'world' }, cx - C.M(14), gy, false, 0, 1, hpMul, rng);
      spawnEnemy(ctx, 'troll', { kind: 'world' }, cx + C.M(14), gy, false, 0, 1, hpMul, rng);
      ctx.showMsg('Something large guards T-Centralen…', now);
    } else if (st.wave === st.waveTotal) {
      spawnEnemy(ctx, 'boss', { kind: 'world' }, cx, gy, true, 0, 1, hpMul, rng);
      ctx.showMsg('⚠ BERGAKUNGEN: the mountain wears a crown.', now);
    }
  }
  if (st.wave > 1 && !(st.name === 'T-Centralen' && st.wave === st.waveTotal))
    ctx.showMsg(`Wave ${st.wave} of ${st.waveTotal}`, now);
}

/** the horde still on the floor, what has to die before the next wave, or the clearing */
export function waveAlive(ctx: CombatHost): number {
  const st = ctx.st;
  let n = 0;
  for (const e of st.enemies) if (e.hp > 0 && e.frame.kind === 'world') n += 1;
  return n;
}

/** per tick, while the party is at a station (not riding) */
export function stepWaves(ctx: CombatHost, dt: number, now: number) {
  const st = stationOf(ctx);
  if (!st) return;
  if (!st.cleared) {
    const alive = waveAlive(ctx);
    if (st.nextWaveAt > 0) {
      if (now >= st.nextWaveAt) spawnWave(ctx, now);
    } else if (st.wave < st.waveTotal) {
      // The next wave does not wait for the last straggler (from play: it
      // made the fight a queue). It comes when the floor is two-thirds
      // clear, or when the current wave has simply had its time.
      if (alive <= Math.ceil(st.waveSize * 0.35) || now - st.waveStartedAt > 16_000) {
        st.nextWaveAt = now + 1200;
        ctx.showMsg(`Wave ${st.wave + 1} of ${st.waveTotal} is coming…`, now);
      }
    } else if (alive === 0) {
      st.cleared = true;
      st.missedTrains = 0;
      ctx.showMsg('Station cleared: the kiosk is open. Two trains, then the dark.', now);
    }
    return;
  }

  // THE DARK IS THE CLOCK. Two trains toward the destination gone: the old
  // world creeps in from both platform ends, faster with every train after,
  // until it has the whole platform. You burn in it; the horde walks it freely.
  if (st.missedTrains >= 2) {
    const rate = C.M(0.55) * (1 + (st.missedTrains - 2) * 0.8) * dt;
    const maxEnc = (st.platformX1 - st.platformX0) / 2 + C.M(2);
    st.corruption = Math.min(st.corruption + rate, maxEnc);
  }
  if (st.corruption > 0) {
    for (const p of activePlayers(ctx.players)) {
      // ON THE PLATFORM, and inside the part the dark has taken. platformAt
      // is a y test only, so out in the tunnel, where there is no platform at
      // all, a walker at platform height counted as standing in it, and every
      // x far enough out is "past the end" by definition. From play: burned by
      // the dark halfway down a tunnel (2026-08-29).
      if (
        p.frame.kind === 'world' &&
        !st.inTunnelX(p.x, p.r) &&
        st.platformAt(p.y) >= 0 &&
        (p.x < st.platformX0 + st.corruption || p.x > st.platformX1 - st.corruption)
      )
        ctx.run.hurt(p, 9, 'The dark is reclaiming the platform!', now);
    }
  }
}
