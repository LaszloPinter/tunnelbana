// A TRAIN IS A WALL WITH DOORS IN IT.
//
// From play 2026-09-10: "Train doors don't open. Whole train wall is pass
// through when the doors are supposed to be open." Both halves are one fault.
// The map knew a standing train with its doors open was not a wall, and drew
// the conclusion for the WHOLE train, so a hundred and forty metres of
// bodywork became an open side you could walk through anywhere, and the
// doorways meant nothing.
//
// A door is 1.4 m of a 15.3 m car. This walks a body into the flank every
// quarter of a metre and asks where it got in: at a doorway (or a coupling
// gap, which is a hole in the train the same way), and nowhere else.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { bodyAt, trainBody, trainCars } from '../../src/world/trains2d.ts';
import { doorNormalOf, metalStops, railTrainOf } from '../../src/world/metal.ts';
import { stepBody } from '../../src/world/body2d.ts';
import { BODY_R } from '../../src/world/walk2d.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let tried = 0;
let doorsSeen = 0;
let wayIn = 0;
let solidFlank = 0;
let samples = 0;

// A RUN'S START IS THE SEED'S, not something a probe may name: pickJourney
// draws it (sim/runStart.ts). Eight probes all naming a station therefore
// tested ONE station eight times, Åkeshov, which is straight, level and
// runs the way its line does. Seeds give the real spread.
for (const seed of [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const edges = new InputEdges();
  const st = asStation(sim.here);
  if (!st || st.rails.length === 0) continue;
  const name = st.name;
  tried += 1;

  // stand still until a train is standing here with its doors fully open
  let jid: string | null = null;
  for (let k = 0; k < 6000 && !jid; k++) {
    for (const pl of sim.places.values()) pl.enemies.length = 0;
    sim.me.health = 999;
    sim.me.iframesUntil = sim.gameNow + 600_000;
    sim.runTick(edges.sample(0, 0, 0, sim.me.x, sim.me.y, answerPicks(sim)));
    for (const rail of st.rails)
      if (rail.journey && rail.train.phase === 'dwell' && rail.train.doorFrac > 0.95) jid = rail.journey;
  }
  if (!jid) {
    faults.push(`${name}: no train ever stood here with its doors open`);
    continue;
  }
  doorsSeen += 1;

  const t = railTrainOf(sim, jid)!;
  const body = trainBody(jid, sim.gameNow)!;
  const at = trainCars(jid, sim.gameNow)!;
  const half = C.CAR_WIDTH / 2;
  const r = BODY_R;
  /**
   * AND THE DOORS FACE THE PLATFORM. A train's `doorSide` is +1 or -1 in the
   * STATION'S own chart, and the map lays the train along its line, whose
   * heading is the way the train travels. At half the stations a service
   * runs the other way through the room (measured: 152 of 304 station
   * pieces), and there the two conventions are mirrors: the doors were drawn,
   * and opened, against the tunnel wall (from play 2026-09-11).
   */
  {
    const mid = at(body.len / 2)!;
    const nx = -mid.ty * doorNormalOf(sim, jid, sim.gameNow);
    const ny = mid.tx * doorNormalOf(sim, jid, sim.gameNow);
    const out = sim.map.at(
      mid.x + nx * (C.CAR_WIDTH / 2 + C.M(1.5)),
      mid.y + ny * (C.CAR_WIDTH / 2 + C.M(1.5)),
    );
    const back = sim.map.at(
      mid.x - nx * (C.CAR_WIDTH / 2 + C.M(1.5)),
      mid.y - ny * (C.CAR_WIDTH / 2 + C.M(1.5)),
    );
    if (out?.kind !== 'platform')
      faults.push(
        `${name}: the doors face ${out?.kind ?? 'nothing'}, not a platform${back?.kind === 'platform' ? ': the deck is on the OTHER side' : ''}`,
      );
  }
  let open = 0;
  let steel = 0;
  const holes: number[] = [];
  const walkedWrong: number[] = [];
  for (let a = C.M(1); a < body.len - C.M(1); a += C.M(0.25)) {
    const p = at(a);
    if (!p) continue;
    // the flank's own outward normal, on the side the doors face
    const nx = -p.ty * doorNormalOf(sim, jid, sim.gameNow);
    const ny = p.tx * doorNormalOf(sim, jid, sim.gameNow);
    const fromX = p.x + nx * (half + r + C.M(0.3));
    const fromY = p.y + ny * (half + r + C.M(0.3));
    // ...and only where a body could be standing to try it
    if (!sim.map.at(fromX, fromY)) continue;
    samples += 1;
    // where the train itself says its holes are: a doorway wide enough to
    // squeeze through, or a coupling gap between two units
    const hole = t.passableAtRel(a, r) || t.gapIndexAt(t.x + a) >= 0;
    // ...and what the MAP makes of the same place, which is the only thing a
    // body ever asks
    const skinX = p.x + nx * (half - C.M(0.4));
    const skinY = p.y + ny * (half - C.M(0.4));
    const along = bodyAt(body, skinX, skinY, r);
    const solid = along === null ? false : sim.metalSolidAt(jid, along, r);
    if (solid) steel += 1;
    else {
      open += 1;
      if (!hole) holes.push(a / C.PX_PER_M);
    }
    // and the same thing walked: a body pressed against the hull slides
    // along it, so it may come in through a doorway a step away, but never
    // through the bodywork between them
    const moved = stepBody(sim, sim.map, fromX, fromY, -nx * C.M(1.4), -ny * C.M(1.4), r, true, false);
    if (bodyAt(body, moved.x, moved.y, -r * 0.5) === null) continue;
    let near = hole;
    for (const d of t.doors) if (a > d.x0 - C.M(1.5) && a < d.x1 + C.M(1.5)) near = true;
    for (const g of t.gaps) if (a > g.x0 - C.M(1.5) && a < g.x1 + C.M(1.5)) near = true;
    if (!near) walkedWrong.push(a / C.PX_PER_M);
  }
  // AND THE SAME WALL STOPS A SHOT. A bolt crossing the flank is stopped by
  // the bodywork and goes through only where a door is open, anything else
  // is a firefight through solid steel (from play 2026-09-11).
  {
    let through = 0;
    let stopped = 0;
    let wrong = 0;
    for (let a = C.M(1); a < body.len - C.M(1); a += C.M(0.5)) {
      const p = at(a);
      if (!p) continue;
      const nx = -p.ty * doorNormalOf(sim, jid, sim.gameNow);
      const ny = p.tx * doorNormalOf(sim, jid, sim.gameNow);
      const reach = C.CAR_WIDTH / 2 + C.M(1);
      const from = { x: p.x + nx * reach, y: p.y + ny * reach };
      const to = { x: p.x - nx * C.M(0.2), y: p.y - ny * C.M(0.2) };
      // a bolt is a small thing: it fits a doorway a body would have to
      // squeeze through, so it is asked about with a bolt's own radius
      const blocked = metalStops(sim, from.x, from.y, to.x, to.y, 2);
      const hole = t.passableAtRel(a, 2) || t.gapIndexAt(t.x + a) >= 0;
      if (blocked) stopped += 1;
      else {
        through += 1;
        if (!hole) wrong += 1;
      }
    }
    if (wrong > 0) faults.push(`${name}: ${wrong} shots went through the bodywork where there is no door`);
    if (through === 0) faults.push(`${name}: no shot could reach an open door`);
    if (stopped === 0) faults.push(`${name}: the flank stopped nothing: a train is not a wall to a bolt`);
  }
  wayIn += open;
  solidFlank += steel;
  if (holes.length)
    faults.push(
      `${name}: the map lets a body through the bodywork at ${holes.length} places that are not a door. First at ${holes[0].toFixed(1)} m along`,
    );
  if (walkedWrong.length)
    faults.push(
      `${name}: walked INTO the train ${walkedWrong.length} times nowhere near a door. First at ${walkedWrong[0].toFixed(1)} m along`,
    );
  if (open === 0) faults.push(`${name}: the doors were open and there was no way in at all`);
  // three doors of 1.4 m in a 15.3 m car, minus the squeeze: a fifth of the
  // flank, give or take the couplings. Half of it would mean the doorways had
  // stopped meaning anything again.
  if (open > steel / 2)
    faults.push(
      `${name}: ${open} of ${open + steel} of the flank is a way in. That is not a door, that is an open side`,
    );
}

const ok = faults.length === 0;
const pct = samples ? Math.round((wayIn / samples) * 100) : 0;
console.log(
  `doors2d: ${doorsSeen}/${tried} stations saw open doors, ${pct}% of the flank is a way in (${wayIn} of ${samples}), ${solidFlank} held out / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
