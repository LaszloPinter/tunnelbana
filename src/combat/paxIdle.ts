import * as C from '../config.ts';
import { dist } from '../sim/det.ts';
import type { Passenger } from '../sim/passenger.ts';
import { islandAtLocal, islandOf, waitSpot } from '../sim/paxSpawn.ts';
import type { Run } from '../sim/run.ts';
import type { Station } from '../sim/station.ts';
import { fromPlatform, onPlatform } from '../world/floor.ts';
import { clearSpot } from '../world/walk2d.ts';

/** how often a group strolls its spot down the platform, a machine is visited */
const STROLL = 0.25;
const MACHINE = 0.15;

/**
 * WAITING IS NOT STANDING STILL (DESIGN §20). Every group stood on one point
 * until its train came (from play 2026-10-12: "why are they not walking
 * around, going to the vending machines?"). Now, every 6–18 s, each of them
 * shifts: a step or two about their group's spot, the group's leader now
 * and then strolling that spot a few metres down the platform (the rest
 * follow), someone wandering over to a machine and back. Always behind the
 * line along THEIR track, never on another island. A guard paces his post.
 * Every choice is the passenger's own content stream, keyed by the moment.
 */
export function idle(run: Run, st: Station, ps: Passenger, now: number) {
  if (now < ps.idleAt) return;
  const rng = run.contentRng(`idle:${ps.id}:${ps.idleAt}`);
  ps.idleAt = now + 6_000 + rng() * 12_000;
  const span = st.platformX1 - st.platformX0 || 1;
  if (ps.plan === 'post') {
    const a = onPlatform(st, ps.anchorX, ps.anchorY);
    if (!a) return;
    const at = fromPlatform(st, a.x + (rng() - 0.5) * C.M(8), a.y);
    const spot = clearSpot(run, at.x, at.y, ps.r, 'platform');
    ps.homeX = spot.x;
    ps.homeY = spot.y;
    return;
  }
  if (ps.plan !== 'catch' || ps.waitTi < 0) return;
  const leader =
    ps.group === ps.id
      ? ps
      : (run.pax.find((q) => q.id === ps.group && q.alive && q.mode === 'foot' && q.placeId === ps.placeId) ??
        ps);
  // THE LEADER STROLLS the group's spot a few metres down the platform
  if (leader === ps && rng() < STROLL) {
    const a = onPlatform(st, ps.anchorX, ps.anchorY);
    if (a) {
      const along = (a.x - st.platformX0) / span + ((rng() < 0.5 ? -1 : 1) * C.M(3 + rng() * 6)) / span;
      const w = waitSpot(run, st, ps.waitTi, Math.max(0.1, Math.min(0.9, along)));
      if (w) {
        ps.anchorX = w.x;
        ps.anchorY = w.y;
      }
    }
  }
  // OVER TO A MACHINE, now and then: one on their own island, not far
  if (rng() < MACHINE) {
    const m = machineNear(st, ps, (rng() - 0.5) * C.M(1.6));
    // ...one at a time: two at one machine stood on one point
    if (
      m &&
      !run.pax.some(
        (q) => q !== ps && q.placeId === ps.placeId && dist(q.homeX - m.x, q.homeY - m.y) < C.M(1.2),
      )
    ) {
      ps.homeX = m.x;
      ps.homeY = m.y;
      return;
    }
  }
  // A STEP OR TWO about the group's spot, behind the line, clear of the others
  const a = onPlatform(st, leader.anchorX, leader.anchorY);
  if (!a) return;
  let best: { x: number; y: number } | null = null;
  let room = -1;
  for (let k = 0; k < 4; k++) {
    const along = (a.x - st.platformX0 + (rng() - 0.5) * C.M(5)) / span;
    const w = waitSpot(run, st, ps.waitTi, along, C.M(1.3 + rng() * 1.9));
    if (!w) continue;
    const r = run.pax.reduce(
      (m, q) => (q === ps || q.placeId !== ps.placeId ? m : Math.min(m, dist(q.homeX - w.x, q.homeY - w.y))),
      Infinity,
    );
    if (r > room) {
      room = r;
      best = w;
    }
    if (r > C.M(1.2)) break;
  }
  if (best) {
    ps.homeX = best.x;
    ps.homeY = best.y;
  }
}

/** a spot in front of a machine on their island, within 30 m (`jitter` along it) */
function machineNear(st: Station, ps: Passenger, jitter: number): { x: number; y: number } | null {
  const l = onPlatform(st, ps.x, ps.y);
  if (!l) return null;
  const mine = islandOf(st, ps.x, ps.y);
  let best: { x: number; y: number } | null = null;
  let bd = C.M(30);
  for (const m of [...st.manaMachines, ...st.healthMachines]) {
    if (islandAtLocal(st, m.y) !== mine) continue;
    const d = Math.abs(m.x - l.x);
    if (d >= bd) continue;
    bd = d;
    // the side of it they are on
    best = fromPlatform(st, m.x + jitter, m.y + (l.y < m.y ? -1 : 1) * C.M(1.3));
  }
  return best;
}
