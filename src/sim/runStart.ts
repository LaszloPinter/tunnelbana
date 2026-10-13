import * as C from '../config.ts';
import { ALL_STATIONS, pickJourney, TUTORIAL_FROM, tutorialJourney } from '../core/network.ts';
import { setTutorialLayout } from './stationPlan.ts';
import { installTutorialFleet, tutorialPen } from './tutorialTrain.ts';
import { scheduleFor } from '../core/schedule.ts';
import { spawnEnemy } from '../combat/enemies.ts';
import { makeParty, makePlayer } from './player.ts';
import type { Run } from './run.ts';
import { levelIndexFor, rebuildHere } from './stationBuild.ts';
import { clearOfFurniture } from './ground.ts';
import { settleIn } from './rideArrival.ts';
import { stepPlaces } from './places.ts';

// TESTING: spawns one boss spider at every run start
const DEBUG_SPAWN_FAUNA = false;

/**
 * A NEW RUN, from a seeded stream: a new world (every place remade on this
 * run's seed), fresh seats, the clocks and counters at zero, the journey
 * dealt, and the party standing on its first platform with the first wave
 * already there.
 */
export function beginWorld(run: Run) {
  const now = 0;
  // a new run is a new world: every place goes, and the one we start in is
  // remade on THIS run's seed (a place's own stream is (runSeed, name))
  const startName = run.station;
  // Tutorialstorg's machines stand together; every other run's are the plan's
  setTutorialLayout(run.tutorial ? TUTORIAL_FROM : null);
  run.places.clear();
  run.hosts.clear();
  run.wantedAt.clear();
  // ...and what WAS live is the old world's: ids of rooms that no longer
  // exist. The map is baked from the live set (src/world/live.ts), so leaving
  // it standing bakes a floor made of holes for the first tick of the new run
  run.live = new Set();
  // THE WHOLE NETWORK IN ONE GO (decided in chat 2026-09-02): every
  // station exists before anyone moves, each a pure function of
  // (runSeed, name), so no place is ever conjured under a player's feet
  if (C.WHOLE_NETWORK) for (const n of ALL_STATIONS) run.ensurePlace(n);
  run.hereId = run.ensurePlace(startName).id;
  for (const p of run.players) p.placeId = run.hereId;
  const home = run.ensurePlace(startName);
  for (const t of home.railTrains) t.reset();
  run.over = null;
  run.briefing = true;
  // Counters are simulation state too: ids decide which side of a column
  // an enemy steps to, so a counter that survived a restart moved the
  // whole horde differently on the second run of a seed
  run.nextEnemyId = 1;
  run.nextProjId = 1;
  run.nextLootId = 1;
  run.pax = [];
  run.nextPaxId = 1;
  run.paxNet = { seen: [], flowAt: {} };
  // and the clock, or the first frame of a run inherits whatever fraction
  // of a step the last one left behind, tick 0 must mean tick 0
  run.clock.reset(run.startTick);
  run.gameNow = 0;
  // every seat starts the run fresh: a player is a value
  run.players = run.players.map((p) => makePlayer(p.id));
  for (const p of run.players) p.iframesUntil = now + 1500;
  run.host.railsChanged();
  run.party = makeParty();
  run.pause = null;
  run.graceSpent = false;
  // the ride's timers are normally overwritten on the first tick, unless
  // that tick is a pick that holds the world (the replay check found it)
  run.nextRideAttackAt = 0;
  run.nextStrikeAt = 0;
  run.bossKills = 0;
  // The whole journey in one draw: start, destination and the route
  // between them (src/core/network.ts)
  // the tutorial is one fixed stop; every other run is the seed's to deal
  installTutorialFleet(run);
  const journey = run.tutorial ? tutorialJourney() : pickJourney(() => run.rng());
  run.ride = 0;
  run.banked = 0;
  run.rides = [];
  run.stopsTotal = 0;
  run.rideFrom = journey.from;
  run.rideStart = now;
  run.rideScheduleS = scheduleFor(journey.legs).totalS;
  run.hereId = run.ensurePlace(journey.from).id;
  // the platform the party stands on is the last one they stood on
  run.lastStationName = journey.from;
  // AND THE PARTY IS STANDING IN IT: every seat was re-made above, which
  // resets placeId, set every seat from `hereId` once the start is settled
  for (const p of run.players) p.placeId = run.hereId;
  // a run always begins on a platform, never in a bore
  const st = run.ensurePlace(journey.from);
  run.destStation = journey.to;
  run.route = journey.legs;
  run.stopsTraveled = 0;
  st.missedTrains = 0;
  st.manaBuysHere = 0;
  run.rideStreak = 0;
  st.corruption = 0;
  st.stationEnteredAt = now;
  st.strikes = [];
  st.boardings = [];
  st.acidPools = [];
  run.runStart = now;
  run.runWallStart = now;
  // start where a train you can use is standing, not on whichever storey
  // happens to be listed first
  const first = run.route[0];
  st.levelIndex = first ? levelIndexFor(st.name, first.service.id, first.dir) : 0;
  rebuildHere(run);
  // the party spawns in a row along the platform's middle
  run.players.forEach((p, i) => {
    p.x = (st.platformX0 + st.platformX1) / 2 + (i - (run.players.length - 1) / 2) * C.M(1.6);
    p.y = (st.platforms[0].top + st.platforms[0].bottom) / 2 + C.M(3);
    clearOfFurniture(st, p);
  });
  run.host.banner(st.name);
  run.showMsg(`Get to ${run.destStation} and out via an EXIT!`, now);
  // THE WORLD IS COMPLETE BEFORE ANYONE LOOKS AT IT. Which places are live
  // is worked out during a TICK (sim/places.ts), so until the first one ran
  // the set was empty, and everything that draws from it drew nothing: no
  // station's picture, no horde, no trains. That was invisible while the
  // first tick followed immediately; it stopped being invisible the moment a
  // run opened with the world held for a couple of seconds (from play
  // 2026-09-12: "an empty skeleton rotating and zooming").
  stepPlaces(run, now);
  settleIn(run, now);
  if (run.tutorial) tutorialPen(run, st);
  if (DEBUG_SPAWN_FAUNA) {
    const cx = (st.platformX0 + st.platformX1) / 2;
    const cy = (st.platforms[0].top + st.platforms[0].bottom) / 2;
    if (!run.tutorial) spawnEnemy(run.hostFor(st), 'spider', { kind: 'world' }, cx - C.M(12), cy, false);
  }
}
