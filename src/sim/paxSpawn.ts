import * as C from '../config.ts';
import { fromPlatform, onPlatform } from '../world/floor.ts';
import { clearSpot } from '../world/walk2d.ts';
import { spawnPassenger, type Passenger, type PassengerKind, type PaxPlan } from './passenger.ts';
import type { Run } from './run.ts';
import type { Station } from './station.ts';

/**
 * WHO IS ON THE PLATFORM (DESIGN §20), and how they come and go.
 *
 * People come in GROUPS of one to four, and every group is here for
 * something: waiting for a train on one track (standing by the edge beside
 * it), or, off a train, on their way out. A guard at his post sometimes.
 * Rolled from the station's own content stream, keyed by the ride of the
 * chain, so a seed always meets the same strangers in the same places and
 * the run's stream is never touched. Never in the tutorial.
 */
export const GROUPS_WAITING = { min: 2, max: 4 };
export const POSTED_GUARD = 0.35;
/** how many strangers will talk to you at all: Swedes are reserved */
export const CHATTY_SHARE = 0.25;
/** of the commuters, how many would like a tenner */
export const ASK_SHARE = 0.3;
/** however busy it gets, a platform holds at most this many strangers */
export const CROWD_MAX = 14;

/** who a stranger is: mostly commuters, then guards, teenagers, a nurse */
export function rollKind(rng: () => number): PassengerKind {
  const r = rng();
  return r < 0.55 ? 'pendlare' : r < 0.73 ? 'vaktare' : r < 0.88 ? 'tonaring' : 'sjukskoterska';
}

/** how many travel together: mostly alone, sometimes four */
export function rollGroupSize(rng: () => number): number {
  const r = rng();
  return r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4;
}

/**
 * ISLANDS ARE NOT CONNECTED for a passenger: nobody crosses the tracks. A
 * goal on another island, an escalator, a track to change to, had them
 * walk to the edge, slide along it, and pile up in the corner where it
 * meets the tunnel (from play 2026-10-11). Every goal is chosen on their
 * own island.
 */
export function islandAtLocal(st: Station, ly: number): number {
  let best = -1;
  let bd = C.M(6);
  st.platforms.forEach((pf, i) => {
    const d = ly >= pf.top && ly <= pf.bottom ? 0 : Math.min(Math.abs(ly - pf.top), Math.abs(ly - pf.bottom));
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** the island a map point is on (or beside), or -1 */
export function islandOf(st: Station, x: number, y: number): number {
  const l = onPlatform(st, x, y);
  return l ? islandAtLocal(st, l.y) : -1;
}

/** the tracks along one island's two edges */
export function railsOfIsland(st: Station, i: number): number[] {
  const pf = st.platforms[i];
  return pf ? [pf.railTop, pf.railBottom].filter((t) => t >= 0) : [];
}

/** the tracks people wait beside: any with an island along it */
export function waitableRails(st: Station): number[] {
  const out: number[] = [];
  for (let ti = 0; ti < st.rails.length; ti++)
    if (st.platforms.some((pf) => pf.railTop === ti || pf.railBottom === ti)) out.push(ti);
  return out;
}

/** where to wait for track `ti`: `back` in from the edge beside it, `along` of the way down the platform */
export function waitSpot(
  run: Run,
  st: Station,
  ti: number,
  along: number,
  back = C.M(2.2),
): { x: number; y: number } | null {
  const pf = st.platforms.find((p) => p.railTop === ti || p.railBottom === ti);
  if (!pf) return null;
  const top = pf.railTop === ti;
  // a couple of metres back from the edge, behind the line, as you do,
  // or the middle of an island too narrow for that
  const b = Math.min(back, (pf.bottom - pf.top) / 2);
  const ly = top ? pf.top + b : pf.bottom - b;
  const lx = st.platformX0 + (st.platformX1 - st.platformX0) * Math.max(0.06, Math.min(0.94, along));
  const at = fromPlatform(st, lx, ly);
  return clearSpot(run, at.x, at.y, C.M(0.55), 'platform');
}

/**
 * WHERE A NEW GROUP WAITS: somewhere down the platform with room around it.
 * Every station's escalators land within metres of its ends, so waiting
 * "where they came down" piled every group at one end, on one point (from
 * play 2026-10-12): people spread out along a platform, away from the others.
 */
export function pickAlong(run: Run, st: Station, rng: () => number): number {
  const span = st.platformX1 - st.platformX0 || 1;
  const taken = run.pax
    .filter((q) => q.alive && q.mode === 'foot' && q.placeId === st.id && q.plan === 'catch')
    .map((q) => onPlatform(st, q.anchorX, q.anchorY)?.x ?? 0);
  let best = 0.5;
  let room = -1;
  for (let k = 0; k < 5; k++) {
    const a = 0.12 + 0.7 * rng();
    const lx = st.platformX0 + span * a;
    const r = taken.reduce((m, x) => Math.min(m, Math.abs(x - lx)), Infinity);
    if (r > room) {
      room = r;
      best = a;
    }
  }
  return best;
}

/** a group, standing about a point, here for `plan` */
export function spawnGroup(
  run: Run,
  st: Station,
  rng: () => number,
  plan: PaxPlan,
  at: (slot: number) => { x: number; y: number } | null,
  now: number,
  waitTi = -1,
): Passenger[] {
  const n = rollGroupSize(rng);
  const out: Passenger[] = [];
  // the line they are waiting for: one of those that stop on their track
  const lines = waitTi >= 0 ? [...new Set(st.rails[waitTi]?.options.map((o) => o.service.id) ?? [])] : [];
  const want = lines.length > 1 ? lines[Math.floor(rng() * lines.length)] : '';
  for (let slot = 0; slot < n; slot++) {
    if (run.pax.filter((q) => q.placeId === st.id).length >= CROWD_MAX) break;
    const p = at(slot);
    if (!p) continue;
    const kind = rollKind(rng);
    const ps = spawnPassenger(run, kind, st.id, p.x, p.y, Math.floor(rng() * 0x7fffffff));
    ps.plan = plan;
    ps.waitTi = waitTi;
    ps.want = want;
    ps.since = now;
    ps.slot = slot;
    ps.anchorX = p.x;
    ps.anchorY = p.y;
    ps.group = out[0]?.id ?? ps.id;
    ps.asks = kind === 'pendlare' && rng() < ASK_SHARE;
    // most keep to themselves (combat/paxTalk.ts)
    ps.chatty = rng() < CHATTY_SHARE;
    out.push(ps);
  }
  return out;
}

/** a group come to wait for a train, at a spot along the edge of one track */
export function spawnWaiting(run: Run, st: Station, rng: () => number, now: number) {
  const rails = waitableRails(st);
  if (rails.length === 0) return;
  const ti = rails[Math.floor(rng() * rails.length)];
  const along = pickAlong(run, st, rng);
  const span = st.platformX1 - st.platformX0 || 1;
  spawnGroup(
    run,
    st,
    rng,
    'catch',
    (slot) => waitSpot(run, st, ti, along + (slot * C.M(0.9)) / span),
    now,
    ti,
  );
}

/** LANGAREN is rare: a station's platform now and then, a train's car now and then */
export const DEALER_PLATFORM = 0.12;
export const DEALER_TRAIN = 0.08;

/** is the dealer already about, where the party is? there is only ever one */
export const dealerAbout = (run: Run): boolean => run.pax.some((q) => q.alive && q.kind === 'langare');

/** the dealer, alone, at a point, here for `plan` */
export function spawnDealer(
  run: Run,
  st: Station,
  at: { x: number; y: number },
  rng: () => number,
  now: number,
) {
  const ps = spawnPassenger(run, 'langare', st.id, at.x, at.y, Math.floor(rng() * 0x7fffffff));
  ps.chatty = true;
  ps.since = now;
  return ps;
}

/** when a station comes alive: who is already waiting, and a guard now and then */
export function populatePassengers(run: Run, st: Station, now: number) {
  if (run.tutorial || st.platforms.length === 0) return;
  if (run.pax.some((q) => q.alive && q.placeId === st.id)) return;
  const rng = run.contentRng(`pax:${st.id}:${run.ride}`);
  const groups = GROUPS_WAITING.min + Math.floor(rng() * (GROUPS_WAITING.max - GROUPS_WAITING.min + 1));
  for (let g = 0; g < groups; g++) spawnWaiting(run, st, rng, now);
  // ...and, now and then, a man in a dark hoodie waiting for a train of his own
  if (rng() < DEALER_PLATFORM && !dealerAbout(run)) {
    const rails = waitableRails(st);
    const ti = rails[Math.floor(rng() * rails.length)];
    const w = ti !== undefined ? waitSpot(run, st, ti, 0.2 + 0.6 * rng()) : null;
    if (w) {
      const d = spawnDealer(run, st, w, rng, now);
      d.plan = 'catch';
      d.waitTi = ti;
      d.homeX = d.anchorX = w.x;
      d.homeY = d.anchorY = w.y;
    }
  }
  if (rng() < POSTED_GUARD) {
    const isl = st.platforms[Math.floor(rng() * st.platforms.length)];
    const lx = st.platformX0 + (st.platformX1 - st.platformX0) * (0.2 + 0.6 * rng());
    const at = fromPlatform(st, lx, (isl.top + isl.bottom) / 2);
    const spot = clearSpot(run, at.x, at.y, C.M(0.55), 'platform');
    const g = spawnPassenger(run, 'vaktare', st.id, spot.x, spot.y, Math.floor(rng() * 0x7fffffff));
    g.plan = 'post';
  }
}

/**
 * THE FLOW: every quarter minute or so, where the party is, a group comes down
 * an escalator to catch a train, so a platform is never only the people
 * who were on it when you arrived.
 */
export function paxFlow(run: Run, st: Station, now: number) {
  if (run.tutorial || st.escalators.length === 0) return;
  const flow = run.paxNet.flowAt;
  const next = flow[st.id];
  if (next === undefined) {
    flow[st.id] = now + 8_000 + run.contentRng(`flow0:${st.id}:${run.ride}`)() * 12_000;
    return;
  }
  if (now < next) return;
  const rng = run.contentRng(`flow:${st.id}:${next}`);
  flow[st.id] = now + 12_000 + rng() * 14_000;
  // down an escalator, to wait for a track along THAT island
  const esc = st.escalators[Math.floor(rng() * st.escalators.length)];
  const rails = railsOfIsland(st, islandAtLocal(st, esc.y));
  if (rails.length === 0) return;
  const ti = rails[Math.floor(rng() * rails.length)];
  // ...and walk down the platform to somewhere with room to wait
  const along = pickAlong(run, st, rng);
  const group = spawnGroup(
    run,
    st,
    rng,
    'catch',
    (slot) => {
      const at = fromPlatform(st, esc.x + (slot - 1.5) * C.M(0.8), esc.y);
      return clearSpot(run, at.x, at.y, C.M(0.55), 'platform');
    },
    now,
    ti,
  );
  for (const ps of group) {
    const w = waitSpot(run, st, ti, along + (ps.slot * C.M(0.9)) / (st.platformX1 - st.platformX0 || 1));
    if (w) {
      ps.homeX = ps.anchorX = w.x;
      ps.homeY = ps.anchorY = w.y;
    }
  }
}
