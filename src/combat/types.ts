import * as C from '../config.ts';
import type { EntityFrame } from '../core/world.ts';
import type { Party, Pause, Player } from '../sim/player.ts';
import type { Place } from '../sim/place.ts';

/**
 * The combat system's own state, and the contract it has with the scene that
 * hosts it. Everything here is data plus a handful of scene-owned effects
 * (taking damage, dying, printing a message), the combat modules are plain
 * functions over a `CombatHost`, the same shape the station builder uses.
 */

/** what an enemy is, in one word, the rig, the stats and the manners all key off it */
export type EnemyKind = 'runner' | 'spitter' | 'troll' | 'spider' | 'boss' | 'daemon';

export const ENEMY_COLORS = {
  runner: { full: 0xd94f4f, hurt: 0x571d1d, stain: 0x3a1414 },
  spitter: { full: 0xb069d6, hurt: 0x45285a, stain: 0x2c1a3a },
  troll: { full: 0x7a8a52, hurt: 0x39411f, stain: 0x2c3220 },
  spider: { full: 0x54486a, hurt: 0x2c2440, stain: 0x241e34 },
  boss: { full: 0x7a8a52, hurt: 0x39411f, stain: 0x2c3220 },
  daemon: { full: 0xb8312c, hurt: 0x4a1412, stain: 0x3a1212 },
} as const;

export interface Enemy {
  id: number;
  type: EnemyKind;
  r: number; // body radius
  frame: EntityFrame;
  steppedAt: number; // last tick stepped: a room change mid-tick must not step it twice
  /** an elite's barrier, held toward whoever it is after (combat/shield.ts) */
  ward?: { hp: number; max: number; angle: number };
  /** world position (derived from frame + train position while aboard) */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speedMul: number;
  slowUntil: number;
  /** has it noticed you? */
  aggro: boolean;
  /** knockback velocity, integrated and decayed each step */
  kvx: number;
  kvy: number;
  wanderX: number;
  wanderY: number;
  nextWanderAt: number;
  stunUntil: number;
  /** impact: shoved and not yet landed, what it slams into takes `dmg`,
   * and is shoved on while `through` lasts */
  impact?: { dmg: number; through: number };
  /** shoved onto the track bed: stays down until this */
  onBedUntil: number;
  hitCdUntil: number;
  shootCdUntil: number;
  /** next acid glob (spider); the boss's next summon rides here too */
  acidAt: number;
  /** spitter: when the wound-up spit leaves (0 = none building), the windup IS the tell */
  spitAt: number;
  /** bergakungen: when the pending slam lands; 0 = none building */
  slamAt: number;
  /** bergakungen: the ground he has MARKED, where the mountain comes down
   * next, and when. Up to three at a time (enemyBoss.ts) */
  marks: { x: number; y: number; at: number }[];
  /** ...and whether the warning about them has been said this fight */
  saidMarks?: boolean;
  /** freshly zapped: the chain will not arc here again until this passes */
  zapCdUntil: number;
  /** bergakungen: when the pending LEAP lands (0 = none), where, and his next */
  leapAt: number;
  leapX: number;
  leapY: number;
  leapCdUntil: number;
  /** bigger types carry their own scale; the view reads it to build the rig */
  sizeMul: number;
  /** HOW it comes at you (enemyAI.ts): rolled once at spawn from the run's rng,
   * so a wave reads as individuals arriving on different lines, not a file */
  approach: Approach;
  /** which side its line bends to: +1 or -1 */
  approachSide: 1 | -1;
  /** the weave's phase, so two weavers are never in step */
  approachPhase: number;
  /** flank: 0 = still heading for the point past you, 1 = closing in.
   * tunnel: 0 = walking to the edge, 1 = running the bed, 2 = climbing */
  approachStage: number;
  /** how far off the line this one's flank/arc goes, or a spitter's hold range (px) */
  approachMag: number;
  /** when the jink re-rolls its lean, when a spitter next flips its strafe */
  approachAt: number;
  /** jink: the current lean, -1.3..1.3 */
  approachLean: number;
  /** the RHYTHM it moves at, independent of the line (enemyAI.ts stepTempo) */
  tempo: Tempo;
  /** stalker: 0 prowl, 1 the crouch (the tell), 2 the burst, 3 spent. skitter: 0 go, 1 freeze */
  tempoState: number;
  /** when the current tempo state ends */
  tempoAt: number;
  /** a vätte's build (see `Variant`): the wave's spread, or the tunnel's own */
  variant: Variant;
  /**
   * Born in the bore, not on the platform (sim/tunnelEvents.ts). A station's
   * horde is leashed to its own mouth, CHASE_REACH past the platform end,
   * and past that the dark is not theirs. The tunnel's own have no such
   * leash: the dark IS theirs, and they follow you the length of the leg.
   */
  ofTunnel: boolean;
  /** one of the pack that thinks (combat/enemyPack.ts): holds a ring when
   * the bite is crowded, sidesteps a bolt on its line, later rides only */
  smart: boolean;
  /** the next sidestep it may take */
  dodgeAt: number;
  /** the side it is going round an obstacle on (world/body2d.ts stepBody) */
  slide: 1 | -1 | 0;
  /** laddning (combat/charge.ts): charges on it, when the last landed, when
   * it may be charged again after going off, and when a blast last hurt it */
  charge: number;
  chargeAt: number;
  chargeLockUntil: number;
  blastAt: number;
}

/**
 * The lines a mob can take to you. The target is always the same, nearest
 * standing commuter, ties by seat, the strategy only bends the PATH there:
 *  rush    straight down the line
 *  jink    leans off the line, re-rolling the lean at random beats: a
 *          zig-zag you cannot time
 *  flank   runs for a point PAST you and off to one side, then turns in, it
 *          arrives from behind
 *  arc     holds a wide offset to one side and curls in over the last metres
 *  tunnel  drops onto the track bed, runs it, and climbs up at your side, a
 *          train on that rail kills it, which is the risk it takes
 */
export type Approach = 'rush' | 'jink' | 'flank' | 'arc' | 'tunnel';

/**
 * The rhythm. steady: one pace. stalker: prowls at half pace, freezes for a
 * beat (the tell), then bursts at twice pace, the Fallen's lunge. skitter:
 * stop-start at random, never the same gap twice.
 */
export type Tempo = 'steady' | 'stalker' | 'skitter';

/**
 * A vätte's build. `runt` and `brute` are the wave's own spread; `stone` and
 * `quick` belong to the TUNNEL (sim/tunnelAmbush.ts), the things that were
 * already down here rather than the ones that came down the escalators. A
 * stone vätte has taken the rock into itself and holds three times the
 * punishment; a quick one has been living beside the traffic and moves and
 * bites at twice the rate.
 */
export type Variant = 'plain' | 'runt' | 'brute' | 'stone' | 'quick' | 'elite';

export interface Proj {
  /** identity, so the renderer can find this one's picture again */
  id: number;
  steppedAt?: number; // last tick stepped; never twice in one tick
  /** a torrent pellet: it shoves what it hits (combat/projectiles.ts) */
  torrent?: boolean;
  /** CAST ABOARD THIS TRAIN: while it flies inside the body it stays filed
   * where the riders are, not where the ground under it says (projectiles.ts) */
  jid?: string;
  frame: 'world';
  ti: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  friendly: boolean;
  /** whose cast this is, seat id, or -1 for the horde's. On-hit perks,
   * chains and kill credit are the owner's, not "the player's" */
  owner: number;
  dieAt: number;
  /** damage this projectile deals on hit */
  dmg: number;
  pierce: number;
  lastHit: number;
  bounces: number;
  color: number;
  /** dark II split children don't split again */
  isSplit: boolean;
  /** spider glob: leaves an acid pool where it lands */
  acid?: boolean;
  /** hostile: cannot hit before this, a spit that left a mouth next to you still needs a beat to arrive */
  armAt?: number;
  /** dark: locked homing target (enemy id), chosen nearest the CURSOR at cast */
  targetId?: number;
  /** dark II: on the curve home to the caster, hitting again on the way */
  returning?: boolean;
  /** ram: a heavy cast, which detonates where it lands */
  heavy?: boolean;
  /** ...and has already gone off */
  spent?: boolean;
  /** the car's velocity it left with, so `flown` is its own flight and not the train's */
  dvx?: number;
  dvy?: number;
  /** how far this bolt has flown of its own accord (Långskott: +damage past 8 m) */
  flown?: number;
  /** a passenger's throw (combat/paxFight.ts): the party's xp, nobody's kill */
  pax?: boolean;
}

// what lies on the floor or in a car: coins, drops, stains, acid (lootTypes.ts)
export type { AcidPool, Loot } from './lootTypes.ts';

/** a telegraphed tunnel-light zone sweeping one car of a moving train */
/**
 * Something working its way in from outside, and the mark it makes doing it.
 *
 * A crawl-in used to appear whole, at one end of the car or the other, which
 * are exactly the two spots worth standing in, so holding an end meant they
 * materialised on top of you. Now the way in is chosen away from wherever you
 * are, along the length of the car rather than only at its ends, and it is
 * SHOWN first: something scrabbles at that window for a second before it is
 * through. Hold the end of a car and you get a lit corridor and a moment's
 * warning, which is all camping should ever buy you.
 */
export interface Boarding {
  id: number;
  ti: number;
  /** THE TRAIN THIS IS HAPPENING TO, not the slot it stands in: a rail is
   * reassigned the moment its train leaves, so a warning pinned to the slot
   * follows whatever pulls in next (combat/hazards.ts onThisTrain). It is
   * also what makes rx/ry a place on the map (world/trainSeat.ts) */
  jid?: string;
  rx: number;
  ry: number;
  at: number;
  type: EnemyKind;
}

export interface Strike {
  id: number;
  ti: number;
  /** the train the light is about to sweep, see Boarding.jid */
  jid?: string;
  x0: number;
  x1: number;
  at: number;
}

/**
 * What the combat modules need from whatever runs the simulation: the
 * station, the players, the entities, the stream, and a handful of host-owned
 * effects. It used to extend Phaser.Scene so combat could draw; it no longer
 * draws, and no longer may, a CombatHost is data and pure functions over it,
 * which is what lets the same code run in four browsers and in a validator.
 */
/** the standard vätte radius; bigger types carry their own */
export const ENEMY_R = C.M(0.5);

/**
 * WHAT THE COMBAT SYSTEM SEES: one place, the run it belongs to, and the
 * seats standing in that place (§17). `st` is the station, its floor, its
 * rails, its waves and everything on it; `run` is what the party shares
 * wherever it is scattered, the seats, the party, the clock, the id
 * counters and the random stream. `players` is only the seats HERE, so an
 * enemy at one station cannot see, chase or bite somebody at another;
 * `run.players` is every seat.
 */
export interface CombatHost {
  st: Place;
  run: RunFacts;
  players: Player[];
  /** a line on the HUD, for one player's eyes if `p` is given, else for everyone standing here */
  showMsg(text: string, now: number, p?: Player): void;
}

/** the run, as combat needs it: shared state and the two things it asks of the run */
export interface RunFacts {
  /** the tutorial run: no horde, no dark (sim/run.ts) */
  readonly tutorial: boolean;
  /** ...and Tutorialstorg's pen, where its dummies stand */
  readonly tutorialPen: { station: string; x0: number; x1: number } | null;
  /** the world is one map, not a graph of rooms with frames (src/world/) */
  /** that map: the walkable world, baked flat and gridded */
  map: import('../world/chunks.ts').Chunks;
  /** every place by id: the CURRENT object for each. The map's own reference
   * may be one the run has since rebuilt (see projectiles.ts) */
  readonly places: ReadonlyMap<string, Place>;
  /** the journeys whose metal could be near a point */
  metalNear(x: number, y: number): string[];
  /** is this track's train standing with its doors open? the one way off a
   * deck without a dash */
  doorOpenOn(st: import('../sim/place.ts').Place, index: number): boolean;
  /** ...and is that train a wall at all? one standing with its doors open is
   * a room you walk into, which is the whole of boarding */
  metalSolidAt(jid: string, along: number, r: number): boolean;
  /** the metal itself, standing at a live platform: where its doors are */
  railTrain(jid: string): import('../core/train.ts').Train | null;
  /** ...and on the STOREY this point is on? the map has no up */
  sameStorey(jid: string, x: number, y: number, inside?: string): boolean;
  /** the room a body stands in now owns it, a lookup, not a crossing */
  reroom(from: import('../sim/place.ts').Place, e: Enemy): void;
  players: Player[];
  localId: number;
  party: Party;
  pause: Pause | null;
  graceSpent: boolean;
  gameNow: number;
  runStart: number;
  stopsTraveled: number;
  /** rides of the chain made so far (sim/chain.ts): the difficulty */
  ride: number;
  rideStreak: number;
  bossKills: number;
  /** the passengers (sim/passenger.ts): the horde's second choice of quarry */
  pax: import('../sim/passenger.ts').Passenger[];
  nextPaxId: number;
  nextEnemyId: number;
  nextProjId: number;
  nextLootId: number;
  nextRideAttackAt: number;
  nextStrikeAt: number;
  /** one-shot effects the simulation asked for; the renderer drains them */
  fx: import('./fx.ts').Fx[];
  /**
   * The run's random stream. Everything the SIMULATION decides must draw from
   * here and never from Math.random, or four clients in lockstep roll
   * different enemies from the same seed (§11c).
   */
  rng(): number;
  /** the run's seed, for what must be a function of the seed alone */
  runSeed: number;
  /** a stream keyed by content identity (sim/det.ts seedOf): what a wave
   * holds, what a kiosk stocks, a function of the SEED, not of the path */
  contentRng(key: string): () => number;
  seatOf(id: number): Player | undefined;
  /** a player takes a hit; the run owns death and what it means */
  hurt(p: Player, n: number, reason: string, now: number, srcX?: number, srcY?: number): void;
}
