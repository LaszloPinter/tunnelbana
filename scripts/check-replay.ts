// The replay check, HEADLESS: the whole simulation in plain Node, no engine,
// no browser, no bundler. This is the §11b validator's skeleton and the proof
// of §11c decision A, a run is a function of (seed, inputs), demonstrated by
// playing it twice and comparing fingerprints every second.
//
//   node --experimental-strip-types scripts/check-replay.ts [seeds…]
//
// Exits non-zero on the first divergence, printing the tick it happened on.
// A run that never advances is a failure too (§12d: a benchmark must assert
// that something ADVANCED before its numbers mean anything).

import { NULL_HOST, Run } from '../src/sim/run.ts';
import { fingerprint } from '../src/sim/fingerprint.ts';
import { CHOICE, InputEdges, type TickInput } from '../src/sim/tick.ts';
import { bot } from './lib/drive.ts';
import { gainXp } from '../src/combat/enemyDeath.ts';
import { pickJourney, NEVER_START, MIN_STOPS, MAX_STOPS, HUB } from '../src/core/network.ts';
import { makeRng } from '../src/sim/det.ts';

const TICKS = 60 * 150;
const EVERY = 60;

/** the scripted commuter: patrols, shoots, boards a standing train */

function startFrom(seed: number, startLevel: number): Run {
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = seed;
  sim.startRun();
  sim.beginRun();
  while (sim.party.level < startLevel - 1) gainXp(sim.hereHost, sim.party.xpNext - sim.party.xp);
  if (startLevel > 1) gainXp(sim.hereHost, sim.party.xpNext - sim.party.xp - 1);
  return sim;
}

let failed = 0;
const seeds = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => !Number.isNaN(n));
for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5, 6]) {
  const startLevel = seed % 2 ? 5 : 12;
  const t0 = performance.now();

  // ---- pass 1: play, recording
  let sim = startFrom(seed, startLevel);
  const edges = new InputEdges();
  const log: TickInput[] = [];
  const prints: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    const b = bot(sim, t);
    const choice = sim.me.offer ? CHOICE.card(0) : CHOICE.none;
    const input = edges.sample(b.held, b.mx, b.my, b.aimX, b.aimY, choice);
    log.push(input);
    sim.runTick(input);
    if (t % EVERY === EVERY - 1) prints.push(fingerprint(sim.simState()));
    if (sim.over) break;
  }
  const first = {
    ticks: log.length,
    kills: sim.me.kills,
    stops: sim.stopsTraveled,
    level: sim.party.level,
    cls: sim.me.laneOrder.join('+') || 'plain',
  };

  // ---- pass 2: the same seed, the recorded inputs
  sim = startFrom(seed, startLevel);
  let divergedAt = -1;
  for (let t = 0; t < log.length; t++) {
    sim.runTick(log[t]);
    if (t % EVERY === EVERY - 1 && fingerprint(sim.simState()) !== prints[Math.floor(t / EVERY)]) {
      divergedAt = t;
      break;
    }
    if (sim.over) break;
  }

  const ms = Math.round(performance.now() - t0);
  const advanced = first.kills > 0 || first.stops > 0 || first.ticks > 600;
  const ok = divergedAt < 0 && advanced;
  if (!ok) failed += 1;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} seed ${String(seed).padEnd(3)} ${String(first.ticks).padStart(5)} ticks · ` +
      `${first.kills} kills · ${first.stops} stops · L${first.level} ${first.cls} · ${ms}ms` +
      (divergedAt >= 0 ? ` · DIVERGED at tick ${divergedAt}` : '') +
      (!advanced ? ' · DID NOT ADVANCE' : ''),
  );
}

// ---- consecutive runs on ONE Run, which nothing above exercises ----
//
// Every check here builds a fresh Run per seed, so a fault that only appears
// on the SECOND run of a session is structurally invisible to them, and one
// was. `startRun` re-makes every seat (`makePlayer`), resetting placeId to its
// default of 'st:T-Centralen'; `set station` then re-keys only the seats whose
// placeId matches the id it is renaming FROM. The first run of a session
// starts at T-Centralen so the default happened to match; the second starts
// from the previous run's random station and left the party standing in a
// place that was not `here`. The horde belongs to `here`, so nothing stepped:
// enemies frozen, casting with nothing to cast at, and a game that looks
// broken while the clock ticks on perfectly.
console.log('\nthe party is standing in the place the run is running:');
{
  const sim = new Run(NULL_HOST);
  sim.station = 'T-Centralen';
  for (let run = 1; run <= 6; run++) {
    sim.seedPinned = true;
    sim.runSeed = run * 7717;
    sim.startRun();
    sim.beginRun();
    const stray = sim.players.filter((p) => p.placeId !== sim.hereId);
    if (stray.length) {
      failed += 1;
      console.log(
        `  FAIL run ${run} at ${sim.station}: seat ${stray[0].id} is in ${stray[0].placeId}, here is ${sim.hereId}`,
      );
      break;
    }
    // and the horde must actually be reachable: step a little and see it move
    const before = sim.here.enemies
      .slice(0, 4)
      .map((e) => `${e.x},${e.y}`)
      .join('|');
    const edges = new InputEdges();
    for (let t = 0; t < 120; t++) {
      sim.runTick(edges.sample(0, 0, 0, sim.me.x + 100, sim.me.y, CHOICE.none));
    }
    const after = sim.here.enemies
      .slice(0, 4)
      .map((e) => `${e.x},${e.y}`)
      .join('|');
    if (sim.here.enemies.length > 0 && before === after) {
      failed += 1;
      console.log(
        `  FAIL run ${run} at ${sim.station}: ${sim.here.enemies.length} enemies, none of them moved`,
      );
      break;
    }
  }
  if (!failed) console.log('  ok   six consecutive runs, party placed and the horde alive in each');
}

// ---- the journey rules (src/core/network.ts) ----
// A run is a journey with one change of line in the middle of it. These are
// gameplay rules, but they are also SEED rules: the daily challenge is a seed,
// so anything that quietly relaxes them hands somebody an easier day than
// everybody else got.
console.log('\nevery seed deals a legal journey:');
{
  let broke = 0;
  const stops: Record<number, number> = {};
  for (let seed = 1; seed <= 2000; seed++) {
    const j = pickJourney(makeRng(seed));
    const colours = new Set(j.legs.map((l) => l.service.color)).size;
    stops[j.stops] = (stops[j.stops] ?? 0) + 1;
    const why =
      j.from === NEVER_START
        ? `starts at ${NEVER_START}`
        : colours < 2
          ? 'never leaves one line'
          : j.stops < MIN_STOPS || j.stops > MAX_STOPS
            ? `is ${j.stops} stops`
            : !j.legs.some((l) => {
                  const all = l.service.stations;
                  const i = all.indexOf(l.from);
                  for (let k = 0; k <= l.stops; k++) if (all[i + l.dir * k] === HUB) return true;
                  return false;
                })
              ? `misses ${HUB}`
              : null;
    if (why) {
      broke += 1;
      console.log(`  FAIL seed ${seed}: ${j.from} -> ${j.to} ${why}`);
      break;
    }
  }
  if (!broke) {
    const spread = Object.keys(stops)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => `${k}:${stops[Number(k)]}`);
    console.log(
      `  ok   2000 seeds, two colours, one change and ${HUB} every time · stops ${spread.join(' ')}`,
    );
  }
  failed += broke;
}

console.log(failed === 0 ? 'PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
