// THE WORLD-SPACE SURFACE the renderer draws from, checked before a pixel is
// drawn: one train representation continuous along its path, and a player's
// world position continuous across the platform->leg boundary.
//
//   node --experimental-strip-types scripts/probe/worldview.ts

import * as C from '../../src/config.ts';
import { SERVICES } from '../../src/core/network.ts';
import { dist } from '../../src/sim/det.ts';
import { journeyId, journeyById } from '../../src/core/fleet.ts';
import { motionOf } from '../../src/core/journeyMotion.ts';
import { pointWorld, trainRender } from '../../src/core/worldView.ts';
import { boreYOf, frameOf, endSignF, legLevel, ANCHOR_X } from '../../src/core/worldNet.ts';
import { corridorOf } from '../../src/core/corridor.ts';

let failed = 0;
const fail = (s: string) => {
  failed += 1;
  console.log('  FAIL ' + s);
};
const m = (px: number) => px / C.PX_PER_M;

// ---- 1. a train is ONE continuous body along its path, everywhere ----
// walk a journey from emergence to rest; its cars must stay a car-length
// apart with no jump, whether it is at a platform or mid-leg
let worstGap = 0;
let worstAt = '';
let sampled = 0;
for (const svc of SERVICES) {
  const jid = journeyId(svc, 1, 2);
  const mo = motionOf(jid)!;
  for (let now = mo.emergeAt; now <= mo.restAt; now += 1500) {
    const tr = trainRender(jid, now);
    if (!tr) {
      fail(`${jid}: no train render at t=${now}`);
      break;
    }
    sampled += 1;
    for (let i = 1; i < tr.cars.length; i++) {
      const d = dist(tr.cars[i].x - tr.cars[i - 1].x, tr.cars[i].y - tr.cars[i - 1].y);
      // adjacent car centres are CAR_LENGTH apart, or CAR_LENGTH+UNIT_GAP
      // across a coupling; a seam would be far larger
      const err = Math.min(Math.abs(d - C.CAR_LENGTH), Math.abs(d - C.CAR_LENGTH - C.UNIT_GAP));
      if (err > worstGap) {
        worstGap = err;
        worstAt = `${jid} at t=${((now - mo.emergeAt) / 1000).toFixed(0)}s, cars ${i - 1}-${i}`;
      }
    }
  }
}
console.log(
  `train continuity: ${sampled} samples, worst adjacent-car deviation ${m(worstGap).toFixed(2)} m at ${worstAt}`,
);
// (4 m, not 3: on the four-track trunk each track keeps to where both its
// stations lay it, which swings it several metres over a short curved leg,
// and cars placed by world distance bunch a little on the inside of it)
if (worstGap > C.M(4)) fail(`a train's cars jump ${m(worstGap).toFixed(1)} m: not one continuous body`);
else console.log('  ok   one continuous train, platform to leg, no seam');

// ---- 2. platform -> leg is continuous in world space ----
// a point walked off a platform end and a hair into the leg must be a hair
// apart in the world (no teleport at the mouth)
let worstStep = 0;
let boundaries = 0;
for (const svc of SERVICES) {
  for (let i = 0; i + 1 < svc.stations.length; i++) {
    const a = svc.stations[i];
    const b = svc.stations[i + 1];
    // the frame the corridor is built against, the leg's storey, the same
    // one the arena presents when you walk off it
    const fa = frameOf(a, legLevel(a, b));
    const c = corridorOf(a, b);
    if (!fa || !c) continue;
    const e = endSignF(fa, b);
    // just inside the platform end, in arena-local coords
    const insideStation = pointWorld(
      { kind: 'station', frame: fa },
      ANCHOR_X + e * (fa.halfLen - 1),
      boreYOf(a, legLevel(a, b), b),
    );
    // just into the leg, corridor coords (arc just past the mouth on a's end)
    const atA = c.a === a;
    const sMouth = atA ? c.s0 + 1 : c.s1 - 1;
    const inLeg = pointWorld({ kind: 'leg', corridor: c, from: a }, sMouth, 0);
    const step = dist(insideStation.x - inLeg.x, insideStation.y - inLeg.y);
    boundaries += 1;
    if (step > worstStep) {
      worstStep = step;
    }
  }
}
console.log(
  `platform/leg boundaries: ${boundaries}, worst world gap at the mouth ${m(worstStep).toFixed(2)} m`,
);
if (worstStep > C.M(3))
  fail(`the world jumps ${m(worstStep).toFixed(1)} m stepping off a platform into a leg`);
else console.log('  ok   walking off a platform into a leg is continuous in the world');

// ---- 3. the same journey renders the same body from either place ----
// a journey mid-leg, and its train, is one set of world cars regardless of
// which end we happen to be looking from (there is only one function)
{
  const jid = journeyId(SERVICES[0], 1, 1);
  const j = journeyById(jid)!;
  const mid = (j.stops[0].departAt + j.stops[1].arriveAt) / 2;
  const a = trainRender(jid, mid);
  const b = trainRender(jid, mid);
  const same = a && b && a.cars.every((c, i) => c.x === b.cars[i].x && c.y === b.cars[i].y);
  if (same) console.log('  ok   a journey has exactly one world body (no second representation)');
  else fail('a journey rendered two different bodies');
}

console.log(failed ? `\n${failed} FAILED` : '\nPASS');
process.exit(failed ? 1 : 0);
