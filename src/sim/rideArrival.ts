import * as C from '../config.ts';
import { populatePassengers } from './paxSpawn.ts';
import { fromPlatform } from '../world/floor.ts';
import { spawnAt } from '../world/walk2d.ts';
import { findRoute } from '../core/network.ts';
import type { Rail } from '../core/world.ts';
import { journeyById } from '../core/fleet.ts';
import { brakeAtInto } from '../core/journeyMotion.ts';
import { beginStationWaves, onTrainMissedAfterClearing } from '../combat/waves.ts';
import type { Station } from './station.ts';
import { anyoneAboard } from './player.ts';
import { asStation } from './place.ts';
import type { Run } from './run.ts';
import { downPlayer } from './harm.ts';
import { levelIndexFor, showLevel } from './stationBuild.ts';
import { placeTrainBody } from './fleetRealise.ts';

/**
 * THE RIDE'S ARRIVAL IS A PLACE CHANGE (§17 stage 5, §18), and the moments
 * on the rails the run reacts to: a train leaving without you, the jolt of
 * departure, the settle of arrival.
 */

/** does any service on this rail move you along your route? */
function railServesRoute(run: Run, rail: Rail): boolean {
  if (run.here.name === run.destStation) return true;
  const leg = run.route[0];
  if (!leg) return true;
  return rail.options.some((o) => o.service.id === leg.service.id && o.dir === leg.dir);
}

/**
 * A RIDDEN TRAIN REACHING ITS BRAKING POINT PULLS INTO THE NEXT PLACE. The
 * braking moment comes straight off the journey's own motion, so position
 * and speed are continuous across the handover (§18). Then the phase edges
 * on every rail of the place the local seat is looking at.
 */
export function stepRides(run: Run, now: number) {
  // a ride only ever happens at a platform; a bore has no metal standing in it
  const st = asStation(run.here);
  if (!st) return;
  for (let ti = 0; ti < st.rails.length; ti++) {
    if (!anyoneAboard(run.players, ti)) continue;
    const jid = st.rails[ti].journey;
    const j = jid ? journeyById(jid) : undefined;
    if (!jid || !j) continue;
    const idx = j.stops.findIndex((s) => s.station === st.name);
    const nxt = idx >= 0 ? j.stops[idx + 1] : undefined;
    if (!nxt || now <= j.stops[idx].departAt) continue;
    const at = brakeAtInto(jid, idx + 1);
    if (at !== null && now >= at) {
      arriveByTrain(run, ti, now);
      break;
    }
  }

  const here = st;
  for (let ti = 0; ti < here.rails.length; ti++) {
    const rail = here.rails[ti];
    const t = rail.train;
    const ridden = anyoneAboard(run.players, ti);
    if (t.phase === here.lastPhases[ti]) continue;
    // jolts reach you only on the train you're riding
    const riding = run.me.frame.kind !== 'world' && run.me.frame.ti === ti;
    // a train left without you. Before the station is cleared that costs
    // nothing extra, you are fighting. After it, only a train you actually
    // NEEDED counts (toward your goal; any train once you're AT the goal,
    // since then you're just loitering), and two of them bring the dark.
    if (
      t.phase === 'departing' &&
      here.lastPhases[ti] === 'dwell' &&
      !ridden &&
      !run.over &&
      here.cleared &&
      railServesRoute(run, rail)
    )
      onTrainMissedAfterClearing(run.hostFor(here), now);
    if (riding && (t.phase === 'departing' || t.phase === 'transit') && here.lastPhases[ti] === 'dwell')
      run.host.feel(run.localId, 'jolt');
    if (riding && t.phase === 'dwell') {
      run.host.feel(run.localId, 'arrive');
      if (run.bannerOnArrive) {
        run.host.banner(run.bannerOnArrive);
        run.bannerOnArrive = null;
      }
    }
    here.lastPhases[ti] = t.phase;
  }
}

/** move the items `take` picks from one list to another, shifting each */
function moveAll<T>(src: T[], dst: T[], take: (it: T) => boolean, shift: (it: T) => void): T[] {
  const keep: T[] = [];
  for (const it of src) {
    if (take(it)) {
      shift(it);
      dst.push(it);
    } else keep.push(it);
  }
  return keep;
}

/**
 * The ridden train has reached its braking point; the station it is pulling
 * into already exists, so the same journey is realised on that station's
 * own track, scheduled to the same second, which by the symmetric speed
 * profile puts it at the same distance-to-stop at the same speed, and the
 * riders, and everything else aboard, change place with their train.
 * Nothing is renamed, re-laid-out or remapped, and the place left behind
 * keeps its floor exactly as it was.
 */
function arriveByTrain(run: Run, ti: number, now: number) {
  const from = asStation(run.here);
  if (!from) return;
  const rail = from.rails[ti];
  const t = rail.train;
  const j = rail.journey ? journeyById(rail.journey) : undefined;
  const at = j ? j.stops.findIndex((s) => s.station === from.name) : -1;
  const stop = j && at >= 0 ? j.stops[at + 1] : undefined;
  if (!j || !stop) return; // transit only ever starts with a next stop (§18)
  const toName = stop.station;
  // where the rider sits on SCREEN, before any of this, the one thing that
  // must not appear to change while the world does
  run.host.stationChanging();
  const dest = run.ensurePlace(toName);
  showLevel(run, dest, levelIndexFor(toName, j.service.id, rail.dir));
  // the destination's own track for this journey; at a terminus the
  // direction convention flips, so fall back to the service alone
  let destTi = dest.rails.findIndex((r) =>
    r.options.some((o) => o.service.id === j.service.id && o.dir === rail.dir),
  );
  if (destTi < 0) destTi = dest.rails.findIndex((r) => r.options.some((o) => o.service.id === j.service.id));
  const destRail = destTi >= 0 ? dest.rails[destTi] : undefined;
  if (destRail) {
    // the same train, by name, now in the place it is pulling into
    destRail.current =
      destRail.options.find((o) => o.service.id === j.service.id && o.dir === rail.dir) ??
      destRail.options.find((o) => o.service.id === j.service.id) ??
      destRail.current;
    destRail.journey = j.id;
    destRail.short = rail.short;
    destRail.train.setCars(t.carCount);
    // position the body from the journey's own motion, exactly where the
    // origin's unrolled copy says it is, in the destination's own frame
    placeTrainBody(dest, destTi, j.id, now);
    const dxw = destRail.train.x - t.x;
    const dy = destRail.train.centerY - t.centerY;
    // riders keep their spot in the car: rx/ry are car-relative and the
    // train is the same length, so only the absolute position moves
    for (const p of run.players) {
      if (p.placeId !== from.id || p.frame.kind === 'world' || p.frame.ti !== ti) continue;
      p.frame.ti = destTi;
      p.placeId = dest.id;
      p.x += dxw;
      p.y += dy;
    }
    // and so does everything else aboard: it changes place WITH the train.
    // (A train-frame thing keeps its x relative to the car but its y
    // absolute, the same convention the old remap shifted by dy.)
    from.enemies = moveAll(
      from.enemies,
      dest.enemies,
      (e) => e.frame.kind === 'aboard' && e.frame.ti === ti,
      (e) => {
        if (e.frame.kind !== 'aboard') return;
        e.frame.ti = destTi;
        e.x += dxw;
        e.y += dy;
      },
    );
    from.boardings = moveAll(
      from.boardings,
      dest.boardings,
      (b) => b.ti === ti,
      (b) => (b.ti = destTi),
    );
    from.strikes = moveAll(
      from.strikes,
      dest.strikes,
      (s) => s.ti === ti,
      (s) => (s.ti = destTi),
    );
    const moveLoot = <T extends { frame: 'world' | 'train'; ti: number; y: number }>(
      src: T[],
      dst: T[],
    ): T[] =>
      moveAll(
        src,
        dst,
        (it) => it.frame === 'train' && it.ti === ti,
        (it) => {
          it.ti = destTi;
          it.y += dy;
        },
      );
    from.coins = moveLoot(from.coins, dest.coins);
    from.pickups = moveLoot(from.pickups, dest.pickups);
    from.stains = moveLoot(from.stains, dest.stains);
    from.acidPools = moveLoot(from.acidPools, dest.acidPools);
    from.projs = moveLoot(from.projs, dest.projs);
  }
  if (!destRail) {
    // NO TRACK FOR THIS TRAIN where it is pulling in. Left as they were, the
    // riders sat on a train that was about to be despawned: carried along
    // invisibly by its journey's motion until the rail they still named was
    // handed the NEXT train to call there, and then they rode that one, to
    // wherever it went (from play 2026-09-25: "our train became invisible
    // mid travel... and I ended up on the green line"). Put down on the
    // platform instead, and said out loud.
    console.warn(`[tunnelbana] no rail at ${toName} for ${j.id}; riders put down on the platform`);
    for (const p of run.players) {
      if (p.placeId !== from.id || p.frame.kind === 'world' || p.frame.ti !== ti) continue;
      const lx = (dest.platformX0 + dest.platformX1) / 2 + p.id * C.M(1.2);
      const ly = (dest.platforms[0].top + dest.platforms[0].bottom) / 2;
      const at = fromPlatform(dest, lx, ly);
      p.frame = { kind: 'world' };
      p.placeId = dest.id;
      spawnAt(run, p, at.x, at.y);
    }
    run.showMsg(`Everybody off: this train goes no further along ${dest.name}'s platform.`, now);
  }
  // the train has left this place; its journey carries on as the
  // destination's realisation of it
  t.despawn();
  from.lastPhases[ti] = 'gone';
  run.hereId = dest.id;
  // Whoever was not aboard is taken by the tunnel (§11c): the party moved,
  // and they arrive with it, DOWNED on the floor of the car beside the
  // rider who brought them, needing a knee and a held E to get up.
  const lead = run.players.find(
    (p) => p.alive && !p.downed && p.frame.kind !== 'world' && p.frame.ti === destTi,
  );
  if (lead && lead.frame.kind !== 'world') {
    const lf = lead.frame;
    for (const p of run.players) {
      if (!p.alive || p.frame.kind !== 'world') continue;
      p.placeId = dest.id;
      p.frame = { kind: 'aboard', ti: destTi, rx: lf.rx, ry: lf.ry };
      p.x = lead.x;
      p.y = lead.y;
      if (!p.downed && run.players.length > 1) {
        downPlayer(run, p, now);
        run.showMsg(`P${p.id + 1} was taken by the tunnel.`, now);
      }
    }
  } else {
    // nobody STANDING is aboard (the rider went down mid-ride): there is no
    // lap to dump anyone onto, the left-behind arrive on the new platform
    // on their feet, mid-platform
    for (const p of run.players) {
      if (!p.alive || p.frame.kind !== 'world') continue;
      p.placeId = dest.id;
      const lx = (dest.platformX0 + dest.platformX1) / 2 + p.id * C.M(1.2);
      const ly = (dest.platforms[0].top + dest.platforms[0].bottom) / 2;
      // said on the map, as the shaft does (sim/ground.ts): the platform's
      // own along-and-across is nowhere in Stockholm
      const at = fromPlatform(dest, lx, ly);
      spawnAt(run, p, at.x, at.y);
    }
  }
  // the run's own bookkeeping: the journey advanced by a stop
  run.route = findRoute(toName, run.destStation) ?? [];
  run.stopsTraveled += 1;
  run.stopsTotal += 1;
  run.rideStreak += 1;
  if (run.rideStreak === 3) run.showMsg('The tunnel has your scent. Set foot on a platform!', now);
  dest.stationEnteredAt = now;
  dest.manaBuysHere = 0;
  run.bannerOnArrive = toName;
  run.host.railsChanged();
  run.host.dressStation();
  run.host.stationChanged('ride');
  settleIn(run, now);
}

/**
 * A place that has come within reach is INHABITED at once: its scatter and
 * first wave are put on the floor the moment it becomes live (places.ts),
 * which is long before anyone sees it down the tunnel, so nothing spawns
 * in front of you. Once, per run: what you find there later is what you
 * left, or what was always there.
 */
export function populateIfFresh(run: Run, st: Station, now: number) {
  if (st.wave > 0 || st.cleared) return;
  beginStationWaves(run.hostFor(st), now);
  // ...and whoever happens to be standing on it (DESIGN §20)
  populatePassengers(run, st, now);
}

/** the party stands on a platform: the vendor is new to them, and the
 * wave clock starts counting from THEIR arrival, not the horde's */
export function settleIn(run: Run, now: number) {
  const st = asStation(run.here);
  if (!st) return;
  populateIfFresh(run, st, now);
  for (const p of run.players) p.shelf = null;
  st.waveStartedAt = now;
}
