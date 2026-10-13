import * as C from '../config.ts';
import type { RouteLeg } from '../core/network.ts';
import type { Fx } from '../combat/fx.ts';
import type { Enemy } from '../combat/types.ts';
import { makeRng, seedOf } from './det.ts';
import { Station } from './station.ts';
import { tutorialReady } from './tutorialTrain.ts';
import { asLeg, asStation, type Place } from './place.ts';
import type { Leg } from './legPlace.ts';
import { corridorOf, type Corridor } from '../core/corridor.ts';
import { PlaceHost } from './placeHost.ts';
import { ensureLeg, ensureStation, hostOf, legBetween, liveStations } from './placeGraph.ts';
import { EMPTY_INPUT, STEP_MS, TickClock, type TickInput } from './tick.ts';
import { makeParty, makePlayer, type Party, type Pause, type Player } from './player.ts';
import { beginWorld } from './runStart.ts';
import type { RunHost } from './runHost.ts';
import type { RideDone } from './chain.ts';

import { makeStation, rebuildAll } from './stationBuild.ts';
import { die, hurt } from './harm.ts';
import { doorOpenOn, metalNear, metalSolidAt, railTrainOf, reroom, sameStorey } from '../world/metal.ts';
import { legIdOf, VENDOR_LEG } from './leg.ts';
import { simState } from './simState.ts';
import { LiveMap } from '../world/live.ts';
import { goFlat } from '../world/start2d.ts';
import { stepRun } from './step.ts';

export { NULL_HOST, type RunHost } from './runHost.ts';

/**
 * THE RUN: the whole simulation of one game, with no engine in the room.
 *
 * Everything that decides what happens lives under here, the players, the
 * horde, the trains, the waves, the picks, the clock, so the same class
 * steps in four browsers and in a validator that has never heard of Phaser.
 * The scene owns the picture: it drives runTick, reads state through `here`
 * and the places, and answers the RunHost callbacks.
 *
 * The class itself holds the run's state and the tick; what happens to a
 * player (walk.ts, ground.ts, corridorWalk.ts, harm.ts), to the trains
 * (fleetRealise.ts, rideArrival.ts) and to the places (places.ts,
 * stationBuild.ts) are plain functions over it.
 */
export class Run {
  readonly host: RunHost;

  /** THE LIVE PLACES (§17): the chain of stations and legs alive at once,
   * by id, station, tunnel, station, tunnel (sim/place.ts) */
  readonly places = new Map<string, Place>();
  readonly hosts = new Map<string, PlaceHost>();
  /** when each place was last wanted, for eviction */
  readonly wantedAt = new Map<string, number>();
  /** the places within reach this tick (places.ts stepPlaces): the ones that tick */
  live = new Set<string>();
  /** said on the map already: one translation, not a thing to do twice */
  onMap = false;
  /** the walkable world, baked flat and gridded, for the rooms in play
   * (src/world/live.ts), and how many rooms have been (re)built under it */
  private readonly liveMap = new LiveMap();
  buildCount = 0;
  /** what the live set was last worked out for (sim/places.ts stepPlaces) */
  liveKey = '';
  get map() {
    return this.liveMap.of(this);
  }

  /** the metal: what is near, which of it is HERE, where its doors are */
  metalNear = (x: number, y: number) => metalNear(this, x, y);
  doorOpenOn = (pl: Place, i: number) => doorOpenOn(pl, i);
  metalSolidAt = (j: string, a: number, r: number) => metalSolidAt(this, j, a, r);
  railTrain = (j: string) => railTrainOf(this, j);
  sameStorey = (j: string, x: number, y: number, inside?: string) => sameStorey(this, j, x, y, inside);
  reroom = (from: Place, e: Enemy) => reroom(this, from, e);
  /** the place the LOCAL seat looks at */
  hereId = Station.idOf('T-Centralen');
  /**
   * The last PLATFORM the party stood on. Stepping out of a bore onto this
   * one is coming back the way you went in; onto the other is arriving
   * somewhere, with the ceremony that carries. A fact about the run, not the
   * tunnel, so the leg need not remember which end you entered by.
   */
  lastStationName = 'T-Centralen';
  get here(): Place {
    return this.places.get(this.hereId)!;
  }

  /** the place a seat is standing in */
  placeOf(p: Player): Place {
    return this.places.get(p.placeId) ?? this.here;
  }

  // THE PLACE GRAPH (sim/placeGraph.ts): stations, the bores between them,
  // and the seams where the two meet
  ensurePlace = (name: string) => ensureStation(this, name);
  ensureLeg = (c: Corridor) => ensureLeg(this, c);
  legBetween = (a: string, b: string) => legBetween(this, a, b);
  stations = () => liveStations(this);

  /** the leg the secret vendor trades on (sim/leg.ts VENDOR_LEG) */
  get vendorLegId(): string {
    return legIdOf(corridorOf(VENDOR_LEG[0], VENDOR_LEG[1])!);
  }
  /** the station the local seat is looking at, null out in a tunnel */
  get hereStation(): Station | null {
    return asStation(this.here);
  }
  /** ...and the leg, when that is where they are */
  get hereLeg(): Leg | null {
    return asLeg(this.here);
  }

  hostFor = (pl: Place) => hostOf(this, pl);

  /** the combat system's view of the place the local seat is looking at */
  get hereHost(): PlaceHost {
    return this.hostFor(this.here);
  }

  /** the simulation's state as plain data, what a fingerprint hashes */
  simState(): Record<string, unknown> {
    return simState(this);
  }

  /** a station built whole without becoming the one we stand in */
  makeStation(name: string, levelIndex = 0): Station {
    return makeStation(this, name, levelIndex);
  }

  get station(): string {
    return this.here.name;
  }
  /** Point the run at a station by name, the pre-run "start here" hook. A JUMP, never a rename. */
  set station(v: string) {
    if (this.here.name === v) return;
    this.hereId = this.ensurePlace(v).id;
    for (const p of this.players) p.placeId = this.hereId;
  }

  /** path coordinates to screen, in the place the local seat is looking at */
  worldY(x: number, y: number): number {
    return this.here.worldY(x, y);
  }

  /** C: 0 = straight, 1 = the old bow. STRAIGHT, because the map is not: the
   * bow stood in for curvature in an unrolled world (stationBuild.ts) */
  curveStrength = 0;
  setCurve(v: number) {
    this.curveStrength = v;
    rebuildAll(this);
  }

  // ---- the run ----
  destStation = 'Slussen';
  route: RouteLeg[] = [];
  stopsTraveled = 0;
  // ---- the chain (sim/chain.ts) ----
  /** rides made so far: the difficulty, and what the next is worth */
  ride = 0;
  /** what the rides made are worth, kept whatever happens next */
  banked = 0;
  rides: RideDone[] = [];
  rideFrom = 'T-Centralen';
  /** when this ride began, and what its timetable says it should take */
  rideStart = 0;
  rideScheduleS = 0;
  /** stops travelled over the whole chain: how far you got */
  stopsTotal = 0;
  rideStreak = 0;
  bannerOnArrive: string | null = null;
  deaths = 0;
  /** how this run ended, if it has */
  over: { kind: 'win' | 'extract' | 'died'; reason: string } | null = null;
  /** THE TUTORIAL RUN: one fixed stop, no horde, no dark, never saved and
   * never on the board (core/network.ts tutorialJourney). Set before
   * startRun by the session; a plain fact about the run like its seed. */
  tutorial = false;
  /** the tutorial's one train, once the last stage has called for it (sim/tutorialTrain.ts) */
  tutorialTrain: string | null = null;
  /** ...and whether it is being held at the platform for the player */
  tutorialHeld = false;
  /** TUTORIALSTORG: the stretch of the tutorial platform a walker may use,
   * in the station's own along-platform x (sim/tutorialTrain.ts tutorialPen) */
  tutorialPen: { station: string; x0: number; x1: number } | null = null;
  /** the overlay's last stage began: the train comes in on cue */
  tutorialReady() {
    tutorialReady(this, this.gameNow);
  }
  /** the pre-run briefing is up: the world waits for START */
  briefing = false;

  // ---- the seats ----
  players: Player[] = [makePlayer(0)];
  localId = 0;
  party: Party = makeParty();
  pause: Pause | null = null;
  graceSpent = false;
  get me(): Player {
    return this.players[this.localId];
  }
  /** every seat, wherever it is standing */
  get allPlayers(): Player[] {
    return this.players;
  }
  seatOf(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  // ---- the entities ----
  nextEnemyId = 1;
  nextProjId = 1;
  nextLootId = 1;
  pax: import('./passenger.ts').Passenger[] = []; // wherever they are (DESIGN §20)
  nextPaxId = 1;
  paxNet = { seen: [] as string[], flowAt: {} as Record<string, number> }; // combat/paxRide.ts
  fx: Fx[] = [];

  // ---- pacing ----
  nextRideAttackAt = 0;
  nextStrikeAt = 0;
  runStart = 0;
  /** wall-of-the-run start in sim time, for the closing stats */
  runWallStart = 0;
  bossKills = 0;
  tunnelWarnUntil = 0;
  /** the places whose rails were realised last tick; leaving one freezes it */
  driven = new Set<string>();

  // ---- the clock and the stream ----
  gameNow = 0;
  clock = new TickClock();
  runSeed = 1;
  seedPinned = false;
  /**
   * The tick this run begins on. 0 solo and in the replay check; in a room it
   * is an ABSOLUTE tick off `C.TICK_EPOCH_MS`, handed over by the relay, so
   * every group in the world is counting the same ticks (§19). It is data,
   * like the seed, the simulation never reads a clock.
   */
  startTick = 0;
  private _rng: () => number = makeRng(1);
  /** the run's random stream; a bound property so helpers receive it with `this` intact */
  rng = (): number => this._rng();

  constructor(host: RunHost) {
    this.host = host;
    const st = new Station('T-Centralen', this.runSeed);
    this.places.set(st.id, st);
    this.hosts.set(st.id, new PlaceHost(this, st));
    this.wantedAt.set(st.id, 0);
    this.hereId = st.id;
  }

  startRun() {
    // Every run is a seed: what a replay validator and three other clients
    // in lockstep are handed (§11c). Choosing the seed is NOT part of the
    // simulation, so it may use the engine's own random, nothing after
    // this point may.
    // eslint-disable-next-line no-restricted-globals, no-restricted-properties -- picking the seed is not simulating
    if (!this.seedPinned) this.runSeed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this._rng = makeRng(this.runSeed);
    beginWorld(this);
  }

  beginRun() {
    this.briefing = false;
    // the clock was frozen during the briefing; start the run's clocks now
    this.runStart = this.gameNow;
    this.runWallStart = this.gameNow;
    if (this.hereStation) this.hereStation.stationEnteredAt = this.gameNow;
    // a grace to find your feet: the horde is already on the platform
    for (const p of this.players) p.iframesUntil = this.gameNow + C.RUN_START_GRACE_MS;
    // ...and everything standing anywhere, said on the map. A run is set up
    // in terms of a station's own plan, the deck, the escalator's foot, so
    // far along the platform, because that is how a plan describes itself;
    // this is where that naming ends (src/world/start2d.ts).
    goFlat(this);
  }

  /**
   * The run ends exactly three ways (§3). The simulation only records WHICH
   * and hands the moment to the host; the overlay, the stats line and the
   * click-to-restart are the picture's business.
   */
  finishRun(kind: 'win' | 'extract' | 'died', reason: string) {
    if (this.over) return;
    this.over = { kind, reason };
    this.host.runOver();
  }

  // ---- the tick ----

  /** a room tick: every seat's input, in seat order */
  runTickWith(inputs: TickInput[]) {
    for (let i = 0; i < this.players.length; i++) this.players[i].input = inputs[i] ?? EMPTY_INPUT;
    this.advance();
  }

  /** exactly one tick, on exactly this input for the local seat */
  runTick(input: TickInput) {
    this.me.input = input;
    this.advance();
  }

  private advance() {
    this.gameNow = this.clock.now;
    this.step(STEP_MS / 1000, this.gameNow);
    // a party pick holds sim time: this tick carried input, but the world
    // did not age, so the next tick's `now` is this one's
    if (this.pause) this.clock.held += 1;
    this.clock.tick += 1;
  }

  private step(dt: number, now: number) {
    stepRun(this, dt, now);
  }

  // ---- what the combat system and the picture ask of the run ----

  hurt(p: Player, n: number, reason: string, now: number, srcX?: number, srcY?: number) {
    hurt(this, p, n, reason, now, srcX, srcY);
  }

  die(p: Player, reason: string) {
    die(this, p, reason);
  }

  /** a HUD line; if it is for one player, only that player's screen shows it */
  showMsg(text: string, _now: number, p?: Player) {
    if (p && p.id !== this.localId) return;
    this.host.msg(text);
  }

  /** pressed into a tunnel wall's alcove, where the trains stand down */
  inRecess(p: Player): boolean {
    const leg = asLeg(this.places.get(p.placeId));
    return !!leg && leg.inRefugeAt(p.x, p.y, p.r);
  }

  /** A stream keyed by CONTENT IDENTITY (det.seedOf). Fresh every call and
   * never cached: a key names one roll, so asking twice must give the same
   * sequence, and a cache keyed on journey ids would grow all run. */
  contentRng(key: string): () => number {
    return makeRng(seedOf(this.runSeed, key));
  }

  static legIdOf = legIdOf;
}
