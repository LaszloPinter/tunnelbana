// PASSENGERS AND THE TRAINS (DESIGN §20): standing on a platform for a few
// minutes, people who wait board THEIR train when it opens, together, and
// ride away; people get off trains and walk out by the escalator; new
// groups come down to wait. The same seed, the same people.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import * as C from '../../src/config.ts';
import { onPlatform } from '../../src/world/floor.ts';
import { asStation } from '../../src/sim/place.ts';

const faults: string[] = [];
const MINUTES = 5;

function watch(seed: number) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  const edges = new InputEdges();
  const here = sim.me.placeId;
  const boarded = new Map<number, string>();
  const groupTrains = new Map<number, Set<string>>();
  const exiting = new Set<number>();
  const born = new Set<number>(sim.pax.map((q) => q.id));
  let newcomers = 0;
  let rodeAway = 0;
  let walkedOut = 0;
  let died = 0;
  const onBed = new Map<number, number>();
  const leaving = new Map<number, number>();
  const edgeTicks = new Map<number, number>();
  const pooled = new Set<number>();
  // NOBODY STANDS ON TOP OF ANOTHER while waiting: every group came down the
  // escalator by the end and waited on one point (from play 2026-10-12)
  const overlapTicks = new Map<string, number>();
  let stacked = 0;
  const rodeIn = new Set<number>();
  const steppedOff = new Set<number>();
  const seated = new Set<number>();
  let last = new Map(sim.pax.map((q) => [q.id, { ...q }]));
  for (let k = 0; k < MINUTES * 3600; k++) {
    const me = sim.me;
    me.iframesUntil = sim.gameNow + 5000;
    me.health = me.maxHealth;
    sim.runTick(edges.sample(0, 0, 0, me.x + 50, me.y, answerPicks(sim)));
    const now = new Map(sim.pax.map((q) => [q.id, { ...q }]));
    // NOBODY ON THE TRACKS: a passenger on foot is on a platform, always
    // (a tick or two on the bed while climbing back is all that is allowed)
    for (const q of sim.pax) {
      if (q.mode !== 'foot') continue;
      if (sim.map.at(q.x, q.y, q.placeId)?.kind === 'bed') onBed.set(q.id, (onBed.get(q.id) ?? 0) + 1);
      // on their way out, and still here a minute and a half later: stuck
      // (not while the horde is near them: kept from the escalator by it, or
      // a guard stopping to fight it, is not stuck, the clock starts over)
      if (q.plan === 'exit' && q.placeId === here) {
        const st = asStation(sim.places.get(q.placeId));
        const threat = st?.enemies.some((en) => en.hp > 0 && Math.hypot(en.x - q.x, en.y - q.y) < C.M(8));
        leaving.set(q.id, threat ? 0 : (leaving.get(q.id) ?? 0) + 1);
      }
      // NOBODY POOLS AT AN EDGE: a goal on another island had them pressed
      // against the edge, sliding into the corner (from play 2026-10-11)
      const st = asStation(sim.places.get(q.placeId));
      const l = st ? onPlatform(st, q.x, q.y) : null;
      const atEdge =
        !!st &&
        !!l &&
        st.platforms.some(
          (pf) =>
            // an edge with a TRACK along it: a side platform's back wall is not one
            (pf.railTop >= 0 && Math.abs(l.y - pf.top) < C.M(1)) ||
            (pf.railBottom >= 0 && Math.abs(l.y - pf.bottom) < C.M(1)),
        );
      if (!atEdge) edgeTicks.delete(q.id);
      else {
        const n = (edgeTicks.get(q.id) ?? 0) + 1;
        edgeTicks.set(q.id, n);
        if (n > 20 * 60) pooled.add(q.id);
      }
    }
    // (not in the horde: bunched up fleeing it is no stacking, the clock starts over)
    const hereSt = asStation(sim.places.get(here));
    const waiting = sim.pax.filter(
      (q) =>
        q.mode === 'foot' &&
        q.plan === 'catch' &&
        q.placeId === here &&
        !hereSt?.enemies.some((en) => en.hp > 0 && Math.hypot(en.x - q.x, en.y - q.y) < C.M(8)),
    );
    const touching = new Set<string>();
    for (let i = 0; i < waiting.length; i++)
      for (let j = i + 1; j < waiting.length; j++)
        if (Math.hypot(waiting[i].x - waiting[j].x, waiting[i].y - waiting[j].y) < C.M(0.5))
          touching.add(`${waiting[i].id}:${waiting[j].id}`);
    for (const key of [...overlapTicks.keys()]) if (!touching.has(key)) overlapTicks.delete(key);
    for (const key of touching) {
      const n = (overlapTicks.get(key) ?? 0) + 1;
      overlapTicks.set(key, n);
      if (n === 10 * 60) stacked += 1;
    }
    for (const q of sim.pax) {
      if (!born.has(q.id) && q.placeId === here) {
        born.add(q.id);
        newcomers += 1;
        if (q.mode === 'aboard') rodeIn.add(q.id);
      }
      if (rodeIn.has(q.id) && q.mode === 'foot') steppedOff.add(q.id);
      if (
        q.mode === 'aboard' &&
        q.frame.kind === 'aboard' &&
        Math.abs(q.frame.rx - q.seatRx) + Math.abs(q.frame.ry - q.seatRy) < 2
      )
        seated.add(q.id);
      // a BOARDING is on foot one tick and aboard the next: those who rode in were never boarders
      if (q.mode === 'aboard' && q.jid && !boarded.has(q.id) && last.get(q.id)?.mode === 'foot') {
        boarded.set(q.id, q.jid);
        if (!groupTrains.has(q.group)) groupTrains.set(q.group, new Set());
        groupTrains.get(q.group)!.add(q.jid);
      }
      if (q.plan === 'exit') exiting.add(q.id);
    }
    for (const [id, q] of last) {
      if (now.has(id)) continue;
      if (boarded.has(id)) rodeAway += 1;
      else if (q.hp > 0 && exiting.has(id)) walkedOut += 1;
      else died += 1;
    }
    last = now;
  }
  // a group boards ONE train together
  let split = 0;
  for (const trains of groupTrains.values()) if (trains.size > 1) split += 1;
  return {
    stuckOnBed: [...onBed.values()].filter((n) => n > 30).length,
    pooled: pooled.size,
    stacked,
    stuckLeaving: [...leaving.values()].filter((n) => n > 90 * 60).length,
    newcomers,
    rodeIn: rodeIn.size,
    steppedOff: steppedOff.size,
    seated: [...boarded.keys()].filter((id) => seated.has(id)).length,
    boarded: boarded.size,
    rodeAway,
    walkedOut,
    died,
    split,
    print: fingerprint(sim.simState()),
  };
}

const total = {
  stuckOnBed: 0,
  stuckLeaving: 0,
  pooled: 0,
  stacked: 0,
  newcomers: 0,
  rodeIn: 0,
  steppedOff: 0,
  seated: 0,
  boarded: 0,
  rodeAway: 0,
  walkedOut: 0,
  died: 0,
  split: 0,
};
for (const seed of [1, 2, 3, 4]) {
  const a = watch(seed);
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += a[k];
  console.log(
    `  seed ${seed}: ${a.newcomers} came (${a.rodeIn} rode in, ${a.steppedOff} stepped off), ${a.boarded} boarded (${a.seated} reached a seat), ${a.rodeAway} rode away, ${a.walkedOut} walked out, ${a.died} died`,
  );
  if (seed === 1 && watch(seed).print !== a.print) faults.push('seed 1 watched twice parts ways');
}
if (total.newcomers === 0) faults.push('nobody new ever came onto the platform');
if (total.pooled > 0)
  faults.push(`${total.pooled} passengers stood pressed at a platform edge for over 20 s`);
if (total.stacked > 0) faults.push(`${total.stacked} pairs waiting stood on top of each other for 10 s`);
if (total.stuckLeaving > 0) faults.push(`${total.stuckLeaving} on their way out never got out (90 s)`);
if (total.stuckOnBed > 0)
  faults.push(`${total.stuckOnBed} passengers stood on the tracks for over half a second`);
if (total.rodeIn === 0) faults.push('nobody was ever already aboard a train coming in');
if (total.rodeIn > 0 && total.steppedOff === 0) faults.push('people rode in and none ever stepped off');
if (total.boarded > 0 && total.seated === 0) faults.push('people boarded and none ever reached a seat');
if (total.boarded === 0) faults.push('nobody ever boarded their train');
if (total.rodeAway === 0) faults.push('nobody ever rode away');
if (total.walkedOut === 0) faults.push('nobody who got off ever walked out by the escalator');
if (total.split > 0) faults.push(`${total.split} groups boarded more than one train between them`);
console.log(
  `paxride: ${total.newcomers} came (${total.rodeIn} rode in), ${total.boarded} boarded their train (${total.seated} to a seat), ${total.rodeAway} rode away, ${total.walkedOut} walked out, ${total.died} died / ${faults.length ? 'FAIL' : 'PASS'}`,
);
for (const f of faults) console.log('  ' + f);
if (faults.length) process.exitCode = 1;
