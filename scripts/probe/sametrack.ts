// Two bodies on one track. For every station and storey, over twenty
// minutes of timetable, the journeys the picture would draw (visibleJourneys)
// are placed on their bands exactly as FleetView places them; two of them
// nose to tail on one band within the station's own stretch is a picture of
// a collision, whatever the timetable meant.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { stationBands } from '../../src/core/stationLayout.ts';
import { Train } from '../../src/core/train.ts';
import * as C from '../../src/config.ts';
import { driveTrains } from '../../src/sim/fleetRealise.ts';
import {
  corridorPieceAt,
  journeyBandAt,
  journeyLocalX,
  pieceKindAt,
  trackLocalY,
  visibleJourneys,
} from '../../src/sim/legView.ts';
import { corridorToward } from '../../src/sim/places.ts';

const sim = new Run(NULL_HOST);
sim.seedPinned = true;
sim.runSeed = 1;
sim.startRun();
let conflicts = 0;
const byStation = new Map<string, number>();
const samples: string[] = [];
const only = process.argv[2];
for (const name of ALL_STATIONS) {
  if (only && name !== only) continue;
  const levels = stationBands(name, 0).levelCount;
  for (let lvl = 0; lvl < levels; lvl++) {
    const st = sim.makeStation(name, lvl);
    for (let now = 0; now < 20 * 60_000; now += 1000) {
      driveTrains(sim, st, now);
      const held = new Map(st.rails.filter((r) => r.journey).map((r) => [r.journey!, r]));
      const placed: { jid: string; x: number; band: number; dir: number; track: number; inBore: boolean }[] =
        [];
      for (const v of visibleJourneys(st, now)) {
        const rail = held.get(v.jid);
        const b = journeyBandAt(st, v.jid);
        const band = rail ? rail.train.centerY : b ? (b.bandTop + b.bandBottom) / 2 : NaN;
        const lx = journeyLocalX(st, v.jid, v.S);
        if (!lx || Number.isNaN(band)) continue;
        // a train in a SIDING has left its band for the centre of the bore
        // (legView trackLocalY): it is not on the through track
        if (pieceKindAt(st, v.jid, v.S) === 'stub') continue;
        const piece = corridorPieceAt(st, v.jid, v.S);
        // the picture draws one tunnel per end (FleetView): trains in the
        // other line's bore off a branch station are not on this chart
        if (piece && piece.cor !== corridorToward(st, lx.x > (st.platformX0 + st.platformX1) / 2 ? 1 : -1))
          continue;
        // two tracks of a braid cross once, and a train on each at that
        // point is a flyover seen from above, not a collision
        if (piece?.wide) continue;
        // on the track AS DRAWN: out on the leg each direction has its own
        // lateral, whichever platform track the terminus gave it
        const drawn = trackLocalY(st, v.jid, lx.x, band);
        placed.push({
          jid: v.jid,
          x: lx.x,
          band: Math.round(drawn / C.M(1)),
          dir: lx.dlx,
          track: Math.round(band),
          inBore: !!piece,
        });
      }
      placed.sort((a, b) => a.band - b.band || a.x - b.x);
      for (let i = 0; i + 1 < placed.length; i++) {
        const a = placed[i];
        const b = placed[i + 1];
        if (a.band !== b.band) continue;
        // one line: the same platform track, or the same lateral out in the
        // bore. A train at a platform and one just past the mouth on a
        // different track that happens to align with it (Slussen's four
        // tracks feeding a two-track bore) are two tracks, not one
        if (a.track !== b.track && !(a.inBore && b.inBore)) continue;
        const gap = b.x - a.x - Train.LENGTH;
        const near = (p: { x: number }) => p.x > st.platformX0 - C.M(300) && p.x < st.platformX1 + C.M(300);
        // the one thing allowed this close: a train turning on a ONE-TRACK
        // terminus, whose arrival and departure are the same metal swapping
        // bodies at the siding
        const oneTrack = st.rails.length === 1 && a.jid.split(':')[0] === b.jid.split(':')[0];
        if (gap < C.M(10) && (near(a) || near(b)) && !oneTrack) {
          conflicts++;
          byStation.set(`${name}/${lvl}`, (byStation.get(`${name}/${lvl}`) ?? 0) + 1);
          if (samples.length < 40 && (!only || now % 5000 === 0))
            samples.push(
              `${name} storey ${lvl} t=${(now / 1000) | 0}s lateral ${a.band} m: ${a.jid} (dir ${a.dir}) at x=${(a.x / C.PX_PER_M) | 0} m and ${b.jid} (dir ${b.dir}) at x=${(b.x / C.PX_PER_M) | 0} m, ${(gap / C.PX_PER_M).toFixed(0)} m apart (platform ${(st.platformX0 / C.PX_PER_M) | 0}..${(st.platformX1 / C.PX_PER_M) | 0})`,
            );
        }
      }
    }
  }
}
console.log(`sametrack: ${conflicts} second-samples with two bodies nose to tail on one band`);
for (const [k, n] of [...byStation].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k}: ${n}`);
for (const s of samples) console.log('  ' + s);
console.log(conflicts ? 'FAIL' : 'PASS');
process.exit(conflicts ? 1 : 0);
