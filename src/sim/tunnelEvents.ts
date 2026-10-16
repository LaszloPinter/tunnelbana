import { asLeg } from './place.ts';
import * as C from '../config.ts';
import { spawnEnemy } from '../combat/enemies.ts';
import { boreTraffic } from './bore.ts';
import type { Leg } from './legPlace.ts';
import type { Player } from './player.ts';
import type { Run } from './run.ts';
import type { Variant } from '../combat/types.ts';
import { fromLeg } from '../world/floor.ts';
import { inBody, trainBody } from '../world/trains2d.ts';

/**
 * WHAT THE TUNNEL DOES TO A WALKER: the traffic it warns them about, and
 * the ambush it springs on them.
 *
 * THE TUNNEL HAS ITS OWN, AND IT SPRINGS ONCE.
 *
 * Walking a leg used to be a race against the timetable and nothing else.
 * Now, once you are deep enough in that neither mouth is close, the leg
 * answers, vättar ahead of you and behind you at the same moment, already
 * looking for you.
 *
 * It happens ONCE PER LEG PER RUN (decided in chat 2026-09-06), and the leg
 * remembers it ITSELF: `leg.cleared` is the same flag a station sets when
 * its waves are done. A tunnel can be cleared exactly as a platform can,
 * fight through it and the walk back is quiet. It used to be a `Set` of leg
 * ids bolted onto the run, because there was no leg to put it on.
 *
 * These are the things that were ALREADY down here, so they are not the
 * wave's runts and brutes: `stone` takes three times the killing, `quick`
 * moves and bites at double (combat/types.ts Variant). Riding past changes
 * nothing, the ambush only ever asks about a walker.
 */

/** how far from BOTH mouths the walker has to be before the leg answers */
/** how far in before the tunnel answers: a third of the way, never less
 * than this nor more than 140 m, every leg long enough to be a walk has
 * one, and a short one springs it near the middle */
const AMBUSH_MIN = C.M(60);
const AMBUSH_MAX = C.M(140);
/**
 * How far up and down the bore they are waiting. OFF CAMERA, both of them:
 * the view is about 40 m of tunnel wide, so at 22 m they simply appeared out
 * of the rock beside the walker, no approach, no telegraph, nothing to read
 * (from play 2026-09-06: "they just spawned quite close. Just poof"). They
 * come from beyond the light instead, and the walk down the bore IS the
 * telegraph.
 */
const NEAR = C.M(65);
const FAR = C.M(150);
/** the least bore a side needs to hold any of them: just past what the
 * view shows, so nothing pops into being on screen (probe ambush) */
const MIN_ROOM = C.M(48);

/** what is down here, by how deep into the run the party has got */
function ambushParty(stops: number, level: number): Variant[] {
  // four at the start, up to fourteen, the stone and quick kinds coming in
  // as it grows (from play 2026-09-16: "super weak and few")
  const n = Math.min(14, 4 + Math.floor(stops * 0.8) + Math.floor(level / 3));
  const out: Variant[] = [];
  for (let i = 0; i < n; i++) {
    const roll = (i * 7 + stops) % 5;
    out.push(roll === 0 ? 'stone' : roll === 2 || roll === 4 ? 'quick' : 'plain');
  }
  return out;
}

/**
 * One walker, one tick. Returns true when the leg answered, so the caller
 * can say so.
 */
/**
 * `s` is the walker's ARC along the bore. In the old world a leg's x was its
 * arc; on the map the walker is a point in Stockholm and the caller projects
 * it (world/walk2d.ts), the ambush and the warning were simply never asked
 * there, so no tunnel ever answered on the map (found in review, 2026-09-15).
 */
export function stepTunnelAmbush(run: Run, leg: Leg, p: Player, s: number): boolean {
  if (!p.alive || leg.cleared) return false;
  // ONLY THE BORE YOU WALKED INTO. Where two lines cross under a station
  // their bores share ground, and a walker is filed into the crossing bore
  // for a few seconds mid-way along it, deep enough, by its own measure,
  // for its own ambush (probe ambush, Mariatorget → Slussen through the
  // Medborgarplatsen bore, 2026-09-23). The tunnel that answers is the one
  // whose mouth you came in by.
  if (leg.cor.a !== run.lastStationName && leg.cor.b !== run.lastStationName) return false;
  const len = leg.cor.s1 - leg.cor.s0;
  const depth = Math.max(AMBUSH_MIN, Math.min(AMBUSH_MAX, len / 3));
  if (s - leg.cor.s0 < depth || leg.cor.s1 - s < depth) return false;
  // ONE AMBUSH BETWEEN TWO STATIONS. A stacked station has a bore per
  // storey between it and its neighbour, on shared ground, and a walker is
  // re-filed from one to the other as it goes, and a sibling made after the
  // first sprang starts fresh, so the second sprang too (probe ambush,
  // Mariatorget → Slussen, 2026-09-23). A sibling that has answered answers
  // for this one.
  const siblings = [...run.places.values()].filter((pl) => {
    const sib = asLeg(pl);
    if (!sib || sib === leg) return false;
    return (
      (sib.cor.a === leg.cor.a && sib.cor.b === leg.cor.b) ||
      (sib.cor.a === leg.cor.b && sib.cor.b === leg.cor.a)
    );
  });
  if (siblings.some((sib) => sib.cleared)) {
    leg.cleared = true;
    return false;
  }
  // NOT WHILE A TRAIN IS PASSING where either side would rise: hatched under
  // its metal, that side was crushed the same tick and the ambush came from
  // one way only (probe ambush, seed 6, Mariatorget to Slussen). It waits
  // for the train to go by, a few seconds, the walker still deep inside.
  if (underMetal(run, leg, s + NEAR) || underMetal(run, leg, s - NEAR)) return false;
  leg.cleared = true;
  for (const sib of siblings) sib.cleared = true;

  const ctx = run.hostFor(leg);
  const party = ambushParty(run.stopsTraveled, run.party.level);
  // half in front, half behind, the point is that both ways are shut. They
  // are placed as PAIRS at a shared distance, so the two sides arrive
  // together and the walker meets a line of them either way.
  const pairs = Math.max(1, Math.ceil(party.length / 2));
  let born = 0;
  // how much bore there is either side before a mouth; a side with less
  // than the nearest ring lends its place to the other, and a ring beyond
  // the room is pulled in, spawned past the mouth they were simply lost,
  // and the ambush came from one side only (probe ambush, 2026-09-18)
  const roomAhead = leg.cor.s1 - C.M(6) - s;
  const roomBehind = s - leg.cor.s0 - C.M(6);
  party.forEach((variant, i) => {
    let ahead = i % 2 === 0 ? 1 : -1;
    if ((ahead > 0 ? roomAhead : roomBehind) < MIN_ROOM) ahead = -ahead;
    const room = ahead > 0 ? roomAhead : roomBehind;
    if (room < MIN_ROOM) return;
    let away = Math.min(room, NEAR + ((FAR - NEAR) * Math.floor(i / 2)) / pairs);
    // NOT UNDER A TRAIN: hatched inside passing metal they were dead the
    // same tick, and the ambush came from one side only (probe ambush)
    for (let tries = 0; tries < 4 && underMetal(run, leg, s + ahead * away); tries++)
      away = Math.min(room, away + C.M(25));
    const x = s + ahead * away;
    // ...and across the bore, inside the rock. The band is the floor in the
    // one frame; the bore's middle is wherever the band's middle is, not zero.
    const band = leg.arcBand(x);
    const mid = (band.top + band.bottom) / 2;
    const half = (band.bottom - band.top) / 2;
    let y = mid + (run.rng() * 2 - 1) * Math.max(0, half - C.M(1.2));
    // A RECESS IS STILL A REFUGE. Nothing is waiting inside one, the alcove
    // is the answer to the traffic, and an ambush that could occupy it would
    // take the tunnel's one safe move away. It stands on the tracks instead:
    // skipped, an open leg's walkway swallowed one whole side of the ambush
    // (probe ambush, Åkeshov–Brommaplan: one mob, all ahead).
    if (leg.inRefuge(x, y, C.M(1))) y = mid;
    // named in the bore's own arc and lateral: spawnEnemy says it on the map
    const e = spawnEnemy(ctx, 'runner', { kind: 'world' }, x, y, true, 0, 1, 1, undefined, variant);
    // the bore is theirs: no platform leash (combat/enemyAI.ts)
    e.ofTunnel = true;
    born += 1;
  });
  return born > 0;
}

/**
 * THE WARNING IS TRUE (§ the tunnel is a race): which way the train is
 * coming, how far off it is, and what to do about it, outrun it, cross, or
 * get to a refuge. Only for the local seat, and only every couple of seconds.
 */
/** is there a train over this arc of the bore right now? */
/**
 * IS THERE METAL HERE, or about to be? Tested across the WHOLE bore, both
 * tracks, and with room for a train a few metres off: tested at the bore's
 * middle with two metres to spare, a spawn on the other track, or in the
 * path of one arriving, was crushed on its first step and the ambush came
 * from one side again (probe ambush, seed 7, 2026-10-10).
 */
function underMetal(run: Run, leg: Leg, s: number): boolean {
  const band = leg.arcBand(s);
  for (const t of [band.top + C.M(1), (band.top + band.bottom) / 2, band.bottom - C.M(1)]) {
    const p = fromLeg(leg, s, t);
    for (const jid of run.metalNear(p.x, p.y)) {
      const body = trainBody(jid, run.gameNow);
      if (body && inBody(body, p.x, p.y, C.M(8))) return true;
    }
  }
  return false;
}

/** `at` is the walker's next point as arc and lateral, `ds` the arc it is
 * moving by, so "behind you" is about the bore, not the stick */
export function warnOfTraffic(
  run: Run,
  leg: Leg,
  p: Player,
  at: { s: number; t: number; ds: number; shielded: boolean },
  now: number,
) {
  if (p.id !== run.localId || run.over || now <= run.tunnelWarnUntil) return;
  for (const tr of boreTraffic(run, leg)) {
    if (Math.abs(tr.vS) < C.M(1)) continue;
    const dS = (at.s - tr.s) * Math.sign(tr.vS);
    if (dS <= 0 || Math.abs(at.t - tr.latAt(at.s)) > C.CAR_WIDTH * 1.2) continue;
    if (dS / Math.abs(tr.vS) >= 5) continue;
    run.tunnelWarnUntil = now + 2500;
    const metres = Math.round(dS / C.PX_PER_M);
    // a train moving the way you are walking is one coming up behind you
    const fromBehind = Math.sign(at.ds || 1) === Math.sign(tr.vS);
    const refuge = leg.open ? 'the walkway' : 'a recess';
    if (at.shielded) run.showMsg(`Safe: hold still and let it pass (${metres} m).`, now, p);
    else if (fromBehind)
      run.showMsg(`TRAIN BEHIND YOU: ${metres} m. Outrun it, or get to ${refuge}.`, now, p);
    else run.showMsg(`ONCOMING: ${metres} m. Cross to the other track, or get to ${refuge}.`, now, p);
    run.host.feel(p.id, 'warn');
    break;
  }
}
