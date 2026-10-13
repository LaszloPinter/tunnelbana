// NO TRAIN APPEARS OUT OF NOWHERE. Walk a leg end to end and ride a stop
// and, every tick, take exactly the set of trains the PICTURE would draw
// near the player (the same metal render/mapMetal.ts draws: what is near,
// on this storey). A journey that is suddenly drawn close without having
// been drawn further off the tick before is a train that popped into the
// world, which is what a player reported arriving at a station (2026-09-05).
//
// ...AND NOTHING CAN CRUSH YOU THAT IS NOT THERE: a walker in a bore only
// ever meets the traffic of the tube they are in (sim/journeyBand.ts).
//
// On the map (2026-09-15): the walk is a routed walk across the baked floor,
// and "near" is a distance on the map, not along a chart.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asLeg, asStation } from '../../src/sim/place.ts';
import { corridorsToward } from '../../src/sim/places.ts';
import { corridorProject } from '../../src/core/corridor.ts';
import { boreTraffic } from '../../src/sim/bore.ts';
import { journeyRuns } from '../../src/sim/journeyBand.ts';
import { trainBody, trainCars } from '../../src/world/trains2d.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { routeTo } from '../../src/world/route2d.ts';
import * as C from '../../src/config.ts';

const NEAR = C.M(120);
/** one piece of metal is chained through many journeys (journeyMotion): a
 * body that changes journey id where it stands is a handover, not a train
 * arriving from nowhere, and the picture draws it continuously */
/** ...and at a terminus the arrival rests in one direction's siding and its
 * successor is born in the other's, a track over and its own length along:
 * a parked train shifting in the dark, not a train arriving from nowhere */
const SAME_SPOT = C.M(25);

/** the trains the picture would draw within reach of the player: each
 * journey's nearest car point, and how far off it is */
function drawn(
  sim: Run,
  px: number,
  py: number,
  inside: string,
): Map<string, { x: number; y: number; d: number }> {
  const out = new Map<string, { x: number; y: number; d: number }>();
  for (const jid of sim.metalNear(px, py)) {
    const body = trainBody(jid, sim.gameNow);
    const seat = trainCars(jid, sim.gameNow);
    if (!body || !seat) continue;
    let best: { x: number; y: number; d: number } | null = null;
    for (let a = 0; a <= body.len; a += C.CAR_LENGTH / 2) {
      const q = seat(Math.min(a, body.len));
      if (!q) continue;
      const d = Math.hypot(q.x - px, q.y - py);
      if (!best || d < best.d) best = { x: q.x, y: q.y, d };
    }
    if (!best || best.d > NEAR * 2) continue;
    if (!sim.sameStorey(jid, best.x, best.y, inside)) continue;
    out.set(jid, best);
  }
  return out;
}

const handedOver = (
  at: { x: number; y: number },
  prev: Map<string, { x: number; y: number }>,
  seen: Map<string, unknown>,
) => {
  for (const [jid, p] of prev)
    if (!seen.has(jid) && Math.hypot(p.x - at.x, p.y - at.y) < SAME_SPOT) return true;
  return false;
};

/** pops seen this tick against the last: drawn close now, not drawn at all before */
function popsBetween(
  prev: Map<string, { x: number; y: number; d: number }>,
  seen: Map<string, { x: number; y: number; d: number }>,
  say: (jid: string, metres: number) => string,
): string[] {
  const out: string[] = [];
  for (const [jid, at] of seen) {
    if (at.d > NEAR || prev.has(jid) || handedOver(at, prev, seen)) continue;
    out.push(say(jid, Math.round(at.d / C.PX_PER_M)));
  }
  return out;
}

/** walk one leg out of a run's first station and watch for pops */
function walkLeg(seed: number, dir: 1 | -1): { pops: string[]; walked: boolean } {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const me = sim.me;
  const edges = new InputEdges();
  const home = asStation(sim.here);
  const c = home && corridorsToward(home, dir)[0];
  if (!home || !c) return { pops: [], walked: false };
  const far = sim.ensurePlace(c.a === home.name ? c.b : c.a);
  const safe = () => {
    me.health = 999;
    me.alive = true;
    me.downed = false;
    me.noTrainHitUntil = sim.gameNow + 60_000;
    me.iframesUntil = sim.gameNow + 60_000;
  };
  safe();
  sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
  const route = routeTo(sim, { x: me.x, y: me.y }, far, me.r);
  if (!route) return { pops: [`seed ${seed} dir ${dir}: no way across the map`], walked: false };
  const pops: string[] = [];
  let prev = drawn(sim, me.x, me.y, me.placeId);
  let k = 0;
  let entered = false;
  for (let t = 0; t < 12000; t++) {
    safe();
    while (k < route.length - 1 && Math.hypot(route[k].x - me.x, route[k].y - me.y) < C.M(1.5)) k += 1;
    const aim = route[k];
    const dx = aim.x - me.x;
    const dy = aim.y - me.y;
    const d = Math.hypot(dx, dy) || 1;
    sim.runTick(edges.sample(0, dx / d, dy / d, me.x, me.y, answerPicks(sim)));
    const seen = drawn(sim, me.x, me.y, me.placeId);
    if (t > 2)
      pops.push(
        ...popsBetween(
          prev,
          seen,
          (jid, m) => `seed ${seed} dir ${dir} t=${t}: ${jid} appeared ${m} m away (${me.placeId})`,
        ),
      );
    prev = seen;
    const leg = asLeg(sim.placeOf(me));
    if (leg) {
      entered = true;
      const s = corridorProject(leg.cor, me.x, me.y).s;
      for (const tr of boreTraffic(sim, leg)) {
        if (Math.abs(tr.s - s) > tr.len / 2 + C.M(6)) continue;
        if (!journeyRuns(tr.jid, leg.cor))
          pops.push(`seed ${seed} dir ${dir} t=${t}: ${tr.jid} runs another storey's tube`);
      }
    }
    const on = sim.map.at(me.x, me.y);
    if (on && on.place === far && on.kind !== 'bore') break;
  }
  return { pops, walked: entered };
}

/** ...and the same watch while RIDING one stop */
function rideOneStop(seed: number): { pops: string[]; rode: boolean } {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const me = sim.me;
  const edges = new InputEdges();
  const from = sim.here.id;
  const pops: string[] = [];
  let prev = new Map<string, { x: number; y: number; d: number }>();
  let aboard = false;
  for (let t = 0; t < 9000; t++) {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    me.health = 999;
    me.iframesUntil = sim.gameNow + 5000;
    if (!aboard) {
      const st = asStation(sim.here);
      const ti = st
        ? st.rails.findIndex((r) => r.journey && r.train.active() && r.train.phase === 'dwell')
        : -1;
      if (st && ti >= 0) {
        const rail = st.rails[ti];
        me.frame = { kind: 'aboard', ti, rx: rail.train.length / 2, ry: 0, jid: rail.journey! };
        aboard = true;
        sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
        prev = drawn(sim, me.x, me.y, me.placeId);
        continue;
      }
      sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
      continue;
    }
    sim.runTick(edges.sample(0, 0, 0, me.x, me.y, answerPicks(sim)));
    const seen = drawn(sim, me.x, me.y, me.placeId);
    pops.push(
      ...popsBetween(
        prev,
        seen,
        (jid, m) => `seed ${seed} riding: ${jid} appeared ${m} m away (${me.placeId})`,
      ),
    );
    prev = seen;
    if (sim.stopsTraveled >= 1 || (sim.here.id !== from && me.frame.kind === 'world')) break;
  }
  return { pops, rode: aboard && sim.stopsTraveled >= 1 };
}

let total = 0;
let walks = 0;
let rides = 0;
const shown: string[] = [];
const faults: string[] = [];
for (let seed = 1; seed <= 12; seed++) {
  for (const dir of [-1, 1] as const) {
    const r = walkLeg(seed, dir);
    if (r.walked) walks += 1;
    total += r.pops.length;
    for (const p of r.pops) if (shown.length < 10) shown.push(p);
  }
}
for (let seed = 1; seed <= 12; seed++) {
  const r = rideOneStop(seed);
  if (r.rode) rides += 1;
  total += r.pops.length;
  for (const p of r.pops) if (shown.length < 10) shown.push(p);
}
if (walks === 0) faults.push('no walk ever entered a bore');
if (rides === 0) faults.push('no ride ever arrived anywhere');
console.log(
  `nopop: ${walks} leg walks and ${rides} rides, ${total} fault(s): a train appearing near the player, or able to crush one it cannot see`,
);
for (const p of [...shown, ...faults]) console.log('  ' + p);
const bad = total > 0 || faults.length > 0;
console.log(bad ? 'FAIL' : 'PASS');
process.exit(bad ? 1 : 0);
