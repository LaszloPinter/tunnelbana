// A SECOND RUN IS A WHOLE NEW WORLD, and the party has to be put down in it.
//
// From play 2026-09-11: "Restarting at a new station = black screen." Setting
// up a run is done in the old world's terms, a station, and everyone on its
// deck in that platform's own along-and-across, and exactly one place
// translates that into a point in Stockholm (src/world/start2d.ts). That
// translation sat behind an "already done" guard meant for the once-a-session
// job beside it, so on the second run nobody was translated: every seat kept
// a platform-local coordinate, read as a place in the city. That is the void,
// nothing underfoot, nothing drawn, and the horde spawning into nowhere.
//
// So: start a run, play a little, start another, and ask the map where
// everybody is standing.
import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { InputEdges } from '../../src/sim/tick.ts';
import { answerPicks } from '../lib/drive.ts';
import { asStation } from '../../src/sim/place.ts';
import { goFlat } from '../../src/world/start2d.ts';
import * as C from '../../src/config.ts';

const faults: string[] = [];
let runs = 0;
let restarts = 0;

for (const seed of [1, 3, 5, 8, 11, 14]) {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  goFlat(sim);
  const edges = new InputEdges();
  const play = (n: number) => {
    for (let k = 0; k < n; k++) sim.runTick(edges.sample(0, 1, 0, sim.me.x, sim.me.y, answerPicks(sim)));
  };
  const standing = (when: string) => {
    const st = asStation(sim.here);
    const on = sim.map.at(sim.me.x, sim.me.y);
    // a walk into an open door is a ride, not a spawn on the tracks
    if (sim.me.frame.kind === 'aboard') return;
    if (!on)
      faults.push(
        `${sim.station} ${when}: standing on NOTHING at ${sim.me.x.toFixed(0)},${sim.me.y.toFixed(0)}`,
      );
    else if (on.kind !== 'platform')
      faults.push(`${sim.station} ${when}: started on a ${on.kind}, not a deck`);
    else if (st && on.place.id !== st.id)
      faults.push(`${sim.station} ${when}: standing in ${on.place.id}, not the station the run says`);
    // ...and there is a world around them, not just the ground they are on
    if (sim.map.patches.length < 4)
      faults.push(`${sim.station} ${when}: the map has ${sim.map.patches.length} patches`);
  };
  standing('at the start');
  runs += 1;
  play(240);
  // R: the scene's restart is a new seed and the same Run, pinned here so
  // the probe asks the same question twice, not a different one each time
  sim.runSeed = seed * 97 + 13;
  sim.startRun();
  sim.beginRun();
  restarts += 1;
  standing('after a restart');
  play(120);
  standing('a moment after a restart');
  // and the horde it spawns is in the world too, not off in the dark
  let lost = 0;
  let total = 0;
  for (const pl of sim.places.values())
    for (const e of pl.enemies) {
      if (e.hp <= 0 || e.frame.kind !== 'world') continue;
      total += 1;
      if (!sim.map.at(e.x, e.y)) lost += 1;
    }
  if (lost > 0)
    faults.push(`${sim.station} after a restart: ${lost} of ${total} of the horde stands on nothing`);
  void C;
}

const ok = faults.length === 0;
console.log(
  `restart2d: ${runs} runs and ${restarts} restarts, everyone put down on the map / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults) console.log(`   ${f}`);
process.exit(ok ? 0 : 1);
