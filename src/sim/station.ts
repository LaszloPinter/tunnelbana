import * as C from '../config.ts';
import { Train } from '../core/train.ts';
import { mulberry32 } from '../core/lineData.ts';
import { stationFrame } from '../core/networkMap.ts';
import { datan2 } from './det.ts';
import { stationSeed } from './stationPlan.ts';
import type { Platform, Rail } from '../core/world.ts';
import type { StationPlan, Box } from './stationPlan.ts';
import { FLAT_PATH, type PlatformPath } from '../core/platformPath.ts';
import type { AcidPool, Boarding, Enemy, Loot, Proj, Strike } from '../combat/types.ts';
import type { Band, Place } from './place.ts';

/**
 * ONE STATION, as a value (§17 stage 1).
 *
 * Everything here used to be a field on `Run`, which is why there could only
 * ever be one station alive: a handover rewrote all of it in place and a
 * remap tried to put back whatever had been attached to a train. Pulled out
 * like this, a station is a thing you can have several of, which is the
 * whole of §17, and `Run` keeps exactly one for now, reached through
 * delegating accessors so no call site has changed yet.
 *
 * The split is by LIFETIME, not by subject: what belongs to a place lives
 * here (its geometry, its furniture, its rails, its waves, the things
 * standing on its floor), and what belongs to the run lives on `Run` (the
 * seats, the party, the clock, the id counters, the random stream).
 *
 * Nothing in here may be built from the run's shared random stream, §17's
 * load-bearing rule. A station's own layout already derives its randomness
 * from `stationSeed(name)`, which is what makes building one order- and
 * timing-independent, and therefore safe to do on demand.
 */
/** how many tracks a station can show at once; each gets a train */
export const MAX_RAILS = 6;

/** everything that stands, lies or flies on one storey's floor */
interface Floor {
  enemies: Enemy[];
  projs: Proj[];
  coins: Loot[];
  pickups: Loot[];
  stains: Loot[];
  acidPools: AcidPool[];
  strikes: Strike[];
  boardings: Boarding[];
}

export class Station implements Place {
  readonly kind = 'station' as const;
  /** the station's name, which is also its identity */
  name: string;

  // ---- where this station IS (src/core/networkMap.ts) ----
  // The station's map position is its world origin: local coordinates are the
  // arena, and this frame is where that arena sits in the one shared network.
  // `mapAxis` is the world heading of local +x, the direction dir = +1 trains
  // leave, and `mapHalfLen` is half the platform's length at map scale, so
  // the +x platform end sits at (mapX + cos(mapAxis)·mapHalfLen, …), which is
  // by construction the point the leg toward the +1 neighbour starts from.
  readonly mapX: number = 0;
  readonly mapY: number = 0;
  readonly mapAxis: number = 0;
  readonly mapHalfLen: number = 0;

  // ---- the box this station occupies, and its furniture ----
  worldW = 0;
  railTrains: Train[] = [];
  rails: Rail[] = [];
  platforms: Platform[] = [];
  passages: { x0: number; x1: number }[] = [];
  worldTopY = 0;
  worldBottomY = 0;
  lastPhases: string[] = [];
  platformX0 = 0;
  platformX1 = 0;
  outdoor = false;
  benches: Box[] = [];
  pillars: Box[] = [];
  escalators: { x: number; y: number }[] = [];
  shafts: { x: number; y: number; w: number; h: number; delta: -1 | 1 }[] = [];
  manaMachines: { x: number; y: number }[] = [];
  healthMachines: { x: number; y: number }[] = [];
  kiosks: { x: number; y: number }[] = [];
  /** the latest plan, kept for the dresser */
  plan: StationPlan | null = null;
  /** bumped by every re-lay (stationBuild.buildInto): the picture rebuilds when it changes */
  buildGen = 0;
  coverLeft = 1;
  coverRight = 1;
  levelIndex = 0;
  storey = 0;
  levelCount = 1;
  /** the centreline; the sim stays straight, the picture bends */
  path: PlatformPath = FLAT_PATH;

  // ---- what is happening here ----
  corruption = 0;
  stationEnteredAt = 0;
  missedTrains = 0;
  manaBuysHere = 0;
  waveTotal = 3;
  wave = 0;
  nextWaveAt = 0;
  waveStartedAt = 0;
  waveSize = 0;
  cleared = false;

  // ---- what is standing on its floor ----
  enemies: Enemy[] = [];
  projs: Proj[] = [];
  coins: Loot[] = [];
  pickups: Loot[] = [];
  stains: Loot[] = [];
  acidPools: AcidPool[] = [];
  strikes: Strike[] = [];
  boardings: Boarding[] = [];
  /** the OTHER storeys' floors, kept while this one is shown. A storey is its
   * own room; its horde waits for you rather than dying when you take the
   * stairs (from play 2026-09-16: "all enemies die if I switch layer") */
  private readonly floors = new Map<number, Floor>();

  /** put this storey's floor away before another is shown */
  stashFloor() {
    this.floors.set(this.levelIndex, {
      enemies: this.enemies,
      projs: this.projs,
      coins: this.coins,
      pickups: this.pickups,
      stains: this.stains,
      acidPools: this.acidPools,
      strikes: this.strikes,
      boardings: this.boardings,
    });
  }

  /** ...and take out the one for the storey now shown, or an empty floor */
  restoreFloor() {
    const f = this.floors.get(this.levelIndex);
    this.floors.delete(this.levelIndex);
    this.enemies = f?.enemies ?? [];
    this.projs = f?.projs ?? [];
    this.coins = f?.coins ?? [];
    this.pickups = f?.pickups ?? [];
    this.stains = f?.stains ?? [];
    this.acidPools = f?.acidPools ?? [];
    this.strikes = f?.strikes ?? [];
    this.boardings = f?.boardings ?? [];
  }

  /**
   * This place's OWN random stream, derived from the run's seed and the
   * station's name, never the run's shared stream (§17's load-bearing rule).
   * Build ORDER depends on where the players go, so a build that drew from
   * the shared stream would make the rest of the run depend on when a
   * neighbour happened to be needed.
   */
  readonly rng: () => number;

  constructor(name: string, runSeed = 1) {
    this.name = name;
    const frame = stationFrame(name);
    if (frame) {
      this.mapX = frame.x;
      this.mapY = frame.y;
      this.mapAxis = frame.axis;
      this.mapHalfLen = frame.halfLen;
    }
    this.rng = mulberry32((stationSeed(name) ^ Math.imul(runSeed, 0x9e3779b1)) | 0);
    // the box this station occupies, and its own trains: a train at one
    // station is not the train at another, so the pool is per place
    this.worldW = C.M(185 + 120);
    this.platformX0 = this.worldW / 2 - C.M(72);
    this.platformX1 = this.worldW / 2 + C.M(72);
    for (let slot = 0; slot < MAX_RAILS; slot++) {
      this.railTrains.push(new Train(0, slot % 2 === 0 ? 1 : -1, slot % 2 === 0 ? 1 : -1));
    }
  }

  // ---- this place's geometry, and the curve its picture is drawn through ----
  // These describe ONE station: with several alive at once "the platforms"
  // and "the path" have to mean a particular place's, not whichever
  // happened to be current.

  /**
   * Path coordinates to screen: the y everything is simulated at, displaced
   * by the centreline at that x. The sim stays straight; the picture bends.
   * Out on a leg the corridor's own coordinates are already the bore's,
   * nothing is squeezed toward a spine any more (that squeeze narrowed the
   * walker and the walls but not the trains, and the trains were drawn in
   * the rock).
   */
  worldY(x: number, y: number): number {
    return y + this.path.offsetAt(x);
  }
  /** the inverse of worldY: a drawn y back into the coordinates it was simulated in */
  pathYAt(x: number, wy: number): number {
    return wy - this.path.offsetAt(x);
  }
  pathOffsetAt(x: number): number {
    return this.path.offsetAt(x);
  }
  drawAngle(x: number, dx: number, dy: number): number {
    if (this.path.flat) return datan2(dy, dx);
    const h = 3;
    const slope = (this.path.offsetAt(x + h) - this.path.offsetAt(x - h)) / (2 * h);
    return datan2(dy + slope * dx, dx);
  }
  platformAt(y: number): number {
    for (let i = 0; i < this.platforms.length; i++) {
      if (y > this.platforms[i].top && y < this.platforms[i].bottom) return i;
    }
    return -1;
  }
  railBedAt(y: number): number {
    if (this.platformAt(y) >= 0) return -1;
    for (let i = 0; i < this.rails.length; i++) {
      const rl = this.rails[i];
      if (y >= rl.bandTop && y <= rl.bandBottom) return i;
    }
    return -1;
  }
  pillarAt(x: number, y: number, r: number): boolean {
    return this.pillars.some((p) => x > p.x0 - r && x < p.x1 + r && y > p.y0 - r && y < p.y1 + r);
  }

  /**
   * Out past either end of the platform there IS no platform, only the two
   * bores. The platform's y-bands still answer `platformAt` out there, which
   * used to drag anything standing in one back into the platform's x-range
   * and let it walk up onto a platform that is a hundred metres behind it.
   */
  inTunnelX(x: number, r = 0): boolean {
    return x < this.platformX0 - r || x > this.platformX1 + r;
  }

  /** the walkable x span of this room (place.ts Place): its platform's ends */
  get x0(): number {
    return this.platformX0;
  }
  get x1(): number {
    return this.platformX1;
  }

  /**
   * The walls at this x. Over the platform there are none, the islands and
   * the beds are what hold a body there, so this answers only for the bores
   * off either end, where the rock is the only thing there is.
   */
  bandAt(x: number): Band | null {
    return this.boreBand ? this.boreBand(x) : null;
  }
  /** set by the run, which owns the leg geometry (sim/bore.ts) */
  boreBand: ((x: number) => Band | null) | null = null;

  /** `st:Name`, a station's id in the place graph (§17) */
  get id(): string {
    return Station.idOf(this.name);
  }
  static idOf(name: string): string {
    return `st:${name}`;
  }

  /** is anything still standing on this floor? (the wave logic asks) */
  get er(): number {
    return C.M(0.5);
  }
}
