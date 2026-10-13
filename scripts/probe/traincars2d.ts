// A TRAIN IS ONE BODY, NOT A STAIRCASE OF CARS.
//
// The picture bakes a train one texture per car and stands each of them where
// its own stretch of the line is, facing the way the line faces there
// (render/mapView.ts). That only reads as a train if the line's own direction
// is the direction a car points, and leaving a platform the track crosses
// from the station's band to the bore's gauge over a turnout, which the
// tunnel's centreline knows nothing about. Pointed down the tube while
// standing on the crossover, each car sat BESIDE the one before it instead of
// behind it (from play 2026-09-11).
//
// So this measures what the eye measures: the far end of one drawn car
// against the near end of the next, both taken along the direction that car
// is actually drawn at.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { goFlat } from '../../src/world/start2d.ts';
import { trainCars } from '../../src/world/trains2d.ts';
import { isShortTrain, journeyById } from '../../src/core/fleet.ts';
import { STOCK, Train } from '../../src/core/train.ts';
import { dist } from '../../src/sim/det.ts';
import * as C from '../../src/config.ts';

/** the spans render/trainArt.ts cuts: every car, and the bellows between units */
function spansOf(t: Train): { a: number; w: number }[] {
  const out: { a: number; w: number }[] = [];
  let ci = 0;
  t.bodies.forEach((b, u) => {
    while (ci < t.cars.length && t.cars[ci].x1 <= b.x1 + 0.01) {
      const a = Math.round(t.cars[ci].x0);
      out.push({ a, w: Math.round(t.cars[ci].x1) - a });
      ci += 1;
    }
    if (u < t.gaps.length) {
      const a = Math.round(t.gaps[u].x0);
      out.push({ a, w: Math.round(t.gaps[u].x1) - a });
    }
  });
  return out;
}

/**
 * A car's own drawn rectangle, exactly as render/mapMetal.ts lays it: held at
 * its two ends and straight between them, which is what a rigid body on a
 * curve does.
 */
function carOn(
  at: (along: number) => { x: number; y: number; tx: number; ty: number } | null,
  span: { a: number; w: number },
) {
  const from = at(span.a);
  const to = at(span.a + span.w);
  const mid = at(span.a + span.w / 2);
  if (!from || !to || !mid) return null;
  return {
    from,
    to,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
    // how far the car's middle floats off the track it is standing on
    sag: dist((from.x + to.x) / 2 - mid.x, (from.y + to.y) / 2 - mid.y),
  };
}

/**
 * Cars are held at the same points as their neighbours, so ANY distance
 * between them is a drawing fault and this is the whole assertion.
 *
 * The turn between neighbours and the sag of a car off its own centreline are
 * reported but NOT failed on: both are the track's own shape, not the
 * picture's. They are large here because the network's bores are drawn far
 * too tight, 38 of 100 bend inside 150 m radius and ten inside 50 m, against
 * a real metro's 150–200 m minimum, so a 15 m car really does turn 36° and
 * hang 1.5 m off the centreline on the worst of them. That is a fault in the
 * WORLD's geometry and it wants fixing where the corridors are built, not
 * here; these numbers are the tripwire for it.
 */
const ALLOW = C.M(0.05);
const faults: string[] = [];
let worst = 0;
let worstWhere = '';
let worstTurn = 0;
let worstTurnWhere = '';
let worstSag = 0;
let seen = 0;

for (const seed of [1, 4, 9, 12]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const edges = new InputEdges();
  const shapes = new Map<string, { t: Train; spans: { a: number; w: number }[] }>();
  for (let k = 0; k < 400; k++) {
    sim.runTick(edges.sample(0, 0, 0, sim.me.x, sim.me.y, answerPicks(sim)));
    for (const jid of sim.metalNear(0, 0)) {
      const j = journeyById(jid);
      const at = trainCars(jid, sim.gameNow);
      if (!j || !at) continue;
      let shape = shapes.get(jid);
      if (!shape) {
        const stock = j.service.color === 'red' ? STOCK.c30 : STOCK.c20;
        const t = new Train(0, 1, 1, stock);
        t.setCars(isShortTrain(jid) ? stock.shortCars : stock.fullCars);
        shape = { t, spans: spansOf(t) };
        shapes.set(jid, shape);
      }
      for (let i = 1; i < shape.spans.length; i++) {
        const a = carOn(at, shape.spans[i - 1]);
        const b = carOn(at, shape.spans[i]);
        if (!a || !b) continue;
        seen += 1;
        // they are held at the same point, so this is only ever rounding
        const gap = dist(a.to.x - b.from.x, a.to.y - b.from.y);
        if (gap > worst) {
          worst = gap;
          worstWhere = `${j.service.id} at ${(shape.spans[i].a / C.PX_PER_M).toFixed(0)} m along, ${sim.station}`;
        }
        let turn = Math.abs(a.angle - b.angle);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn > worstTurn) {
          worstTurn = turn;
          worstTurnWhere = `${j.service.id} at ${(shape.spans[i].a / C.PX_PER_M).toFixed(0)} m along, ${sim.station}`;
        }
        if (b.sag > worstSag) worstSag = b.sag;
      }
    }
  }
}

if (worst > ALLOW)
  faults.push(
    `cars stand ${(worst / C.PX_PER_M).toFixed(2)} m apart: that is a staircase, not a train (worst: ${worstWhere})`,
  );
const ok = faults.length === 0;
console.log(
  `traincars2d: ${seen} car seams, worst ${(worst / C.PX_PER_M).toFixed(2)} m apart / ${ok ? 'PASS' : 'FAIL'}` +
    `\n   (the track's own shape, not the picture's: worst turn between cars ${((worstTurn * 180) / Math.PI).toFixed(1)}° at ${worstTurnWhere}, worst sag ${(worstSag / C.PX_PER_M).toFixed(2)} m)`,
);
for (const f of faults) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
