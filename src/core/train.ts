import * as C from '../config.ts';

export type TrainPhase = 'gone' | 'arriving' | 'dwell' | 'transit' | 'departing';

/** A horizontal span relative to the train's left edge. */
export interface Segment {
  x0: number;
  x1: number;
}

const UNIT_LEN = C.CARS_PER_UNIT * C.CAR_LENGTH;

/**
 * The two kinds of stock, and the tactical difference between them (§5).
 *
 * C20 (green and blue): three articulated sections per unit, units coupled
 * externally. Each unit is a sealed room while the train moves, and the
 * couplings between them are the player's traversal layer.
 *
 * C30 (red): one continuous walk-through corridor for the whole train. No
 * external couplings, so no joint riding and no partial safety, enemies flow
 * the entire length, and so can you.
 */
export interface Stock {
  id: 'c20' | 'c30';
  /** how many car sections share one body before an external coupling */
  carsPerUnit: number;
  /** a full-length train, and a kort tåg, in car sections */
  fullCars: number;
  shortCars: number;
  /**
   * How it is seated. The C20 has facing 2+2 bays across the car; the C30 is
   * benched along the walls, everyone turned in toward the aisle. That is not
   * decoration, a bay is nearly a metre deep and a bench about half that, so
   * the C30's aisle is far wider, which is exactly how the two feel to walk
   * down.
   */
  longitudinal: boolean;
}

export const STOCK: Record<Stock['id'], Stock> = {
  c20: { id: 'c20', carsPerUnit: C.CARS_PER_UNIT, fullCars: 9, shortCars: 6, longitudinal: false },
  c30: { id: 'c30', carsPerUnit: 9, fullCars: 9, shortCars: 6, longitudinal: true },
};

/**
 * One coupled train on a horizontal track: its BODY, cars, couplings,
 * doors and seats, and its POSE, which the fleet writes every tick from
 * the journey's own motion (src/sim/fleetRealise.ts). Nothing here moves
 * itself. `dir` is its travel direction (+1 rightward, -1 leftward);
 * `doorSide` is which side faces the platform (+1 = doors on the
 * bottom/south edge, -1 = top/north edge). `x` is always the LEFT edge.
 */
export class Train {
  /** a full-length train: what the platforms are built for, and the most the
   * world ever has to make room for */
  static readonly LENGTH = C.UNITS_PER_TRAIN * UNIT_LEN + (C.UNITS_PER_TRAIN - 1) * C.UNIT_GAP;

  /** which stock this train is: it decides where the couplings are, and so
   * whether the train is a row of sealed rooms or one corridor */
  private _stock: Stock = STOCK.c20;
  /** how many car sections it is running: nine is full length, six is a kort
   * tåg. Real short trains stop with their FRONT on the same mark, so it is
   * the back of the platform that goes empty, which is the whole reason
   * reading the board is worth anything. */
  private _cars = STOCK.c20.fullCars;
  /** this train's own length; Train.LENGTH is the longest one possible */
  length = Train.LENGTH;

  phase: TrainPhase = 'gone';
  /** world x of the left edge */
  x = -1e9;
  /** px/s, signed (dir * profile speed) */
  speed = 0;
  /** 0 = shut, 1 = fully open; leaves slide to the sides */
  doorFrac = 0;
  doorsOpen = false;

  arriveAt = 0;
  departAt = 0;

  /** solid walk-through unit bodies, left-edge-relative */
  readonly bodies: Segment[] = [];
  /** external joint gaps between units, left-edge-relative */
  readonly gaps: Segment[] = [];
  /** door openings (platform side), left-edge-relative */
  readonly doors: Segment[] = [];
  /** individual cars, in order along the train, the unit of rendering
   * (a curved track rotates each of these along the platform centreline) */
  readonly cars: Segment[] = [];
  /** seat bays (rel boxes: x from left edge, y from centerline) */
  readonly seats: { x0: number; x1: number; y0: number; y1: number; bench: boolean }[] = [];
  /** stroller/wheelchair bays, open floor, marked, one per car */
  readonly flexAreas: { x0: number; x1: number; side: 1 | -1 }[] = [];

  /** mutable: stations with different platform counts move the tracks */
  centerY: number;
  private _doorSide: 1 | -1;
  dir: 1 | -1;

  // (plain assignments: Node's strip-only TS has no parameter properties,
  // and this class runs in the headless validator)
  constructor(centerY: number, dir: 1 | -1, doorSide: 1 | -1, stock: Stock = STOCK.c20) {
    this.dir = dir;
    this.centerY = centerY;
    this._doorSide = doorSide;
    this._stock = stock;
    this._cars = stock.fullCars;
    this.buildBody();
  }

  /** which side faces the platform: the interior blockout mirrors with it */
  get doorSide(): 1 | -1 {
    return this._doorSide;
  }

  /**
   * A slot's train changes which way it faces when a station re-lays out, and
   * the flex bays sit on the platform side, so the interior has to be rebuilt
   * with it. (Leaving it stale put the wheelchair bay against the wrong wall.)
   */
  setDoorSide(side: 1 | -1) {
    if (side === this._doorSide) return;
    this._doorSide = side;
    this.buildInterior();
  }

  get stock() {
    return this._stock;
  }

  /** car sections currently coupled up */
  get carCount() {
    return this._cars;
  }

  /** how many separate bodies this train has: a C20 has three, a C30 has one */
  get unitCount() {
    return this.bodies.length;
  }

  /** run this train as `n` car sections; the stock decides where they split */
  setCars(n: number) {
    const cars = Math.max(1, Math.min(this._stock.fullCars, Math.round(n)));
    if (cars === this._cars) return;
    this._cars = cars;
    this.buildBody();
  }

  /** C20 on the green and blue lines, C30 on the red */
  setStock(stock: Stock) {
    if (stock.id === this._stock.id) return;
    this._stock = stock;
    this._cars = Math.min(this._cars, stock.fullCars);
    this.buildBody();
  }

  private buildBody() {
    this.bodies.length = 0;
    this.gaps.length = 0;
    this.doors.length = 0;
    this.cars.length = 0;
    let off = 0;
    let left = this._cars;
    while (left > 0) {
      const n = Math.min(this._stock.carsPerUnit, left);
      this.bodies.push({ x0: off, x1: off + n * C.CAR_LENGTH });
      for (let car = 0; car < n; car++) {
        const carStart = off + car * C.CAR_LENGTH;
        this.cars.push({ x0: carStart, x1: carStart + C.CAR_LENGTH });
        for (const f of [0.22, 0.5, 0.78]) {
          const cx = carStart + f * C.CAR_LENGTH;
          this.doors.push({ x0: cx - C.DOOR_WIDTH / 2, x1: cx + C.DOOR_WIDTH / 2 });
        }
      }
      off += n * C.CAR_LENGTH;
      left -= n;
      // an external coupling only exists between bodies, which is what makes
      // the C20 a row of rooms and the C30 a corridor
      if (left > 0) {
        this.gaps.push({ x0: off, x1: off + C.UNIT_GAP });
        off += C.UNIT_GAP;
      }
    }
    this.length = off;
    this.buildInterior();
  }

  /** interior blockout after the C20 ritning: facing 2+2 seat groups between
   * door vestibules, one stroller/wheelchair bay per car by the middle door
   * (platform side), center aisle kept walkable */
  private buildInterior() {
    this.seats.length = 0;
    this.flexAreas.length = 0;
    for (let ci = 0; ci < this.cars.length; ci++) {
      const carStart = this.cars[ci].x0;
      const carDoors = this.doors.slice(ci * 3, ci * 3 + 3);
      const pad = C.M(0.4);
      // a facing bay is deep; a bench along the wall is not
      const bench = this._stock.longitudinal;
      const seatDepth = bench ? C.M(0.5) : C.M(0.85);
      const wallIn = C.CAR_WIDTH / 2 - 3;
      const groupLen = C.M(1.9); // one facing pair group along the car
      const groupGap = C.M(0.3);
      const secs: [number, number][] = [
        [carStart + C.M(0.5), carDoors[0].x0 - pad],
        [carDoors[0].x1 + pad, carDoors[1].x0 - pad],
        [carDoors[1].x1 + pad, carDoors[2].x0 - pad],
        [carDoors[2].x1 + pad, carStart + C.CAR_LENGTH - C.M(0.5)],
      ];
      secs.forEach((sec, si) => {
        if (sec[1] - sec[0] < C.M(1)) return;
        for (const side of [1, -1] as const) {
          if (si === 1 && side === this._doorSide) {
            this.flexAreas.push({ x0: sec[0], x1: sec[1], side });
            continue;
          }
          const y0 = side === 1 ? wallIn - seatDepth : -wallIn;
          const y1 = side === 1 ? wallIn : -wallIn + seatDepth;
          if (bench) {
            // one run of bench between the doors, not a row of bays
            this.seats.push({ x0: sec[0], x1: sec[1], y0, y1, bench });
            continue;
          }
          let gx = sec[0];
          while (gx + groupLen <= sec[1]) {
            this.seats.push({ x0: gx, x1: gx + groupLen, y0, y1, bench });
            gx += groupLen + groupGap;
          }
          if (sec[1] - gx > C.M(0.9)) this.seats.push({ x0: gx, x1: sec[1], y0, y1, bench });
        }
      });
    }
  }

  /** does a body of radius r collide with a seat bay at local (rx, ry)? forgiving inflate */
  seatBlocked(rx: number, ry: number, r: number): boolean {
    // A bay-seated car leaves an aisle 1.37m wide and the player is 0.9m
    // across, so inflating the seats by half a body left 0.3px of slack down
    // the middle of a C20, passable in principle, maddening in practice.
    // The inflate is now a nudge rather than a moat.
    const pad = r * 0.2;
    for (const s of this.seats) {
      if (rx > s.x0 - pad && rx < s.x1 + pad && ry > s.y0 - pad && ry < s.y1 + pad) return true;
    }
    return false;
  }

  get top() {
    return this.centerY - C.CAR_WIDTH / 2;
  }
  get bottom() {
    return this.centerY + C.CAR_WIDTH / 2;
  }

  despawn() {
    this.phase = 'gone';
    this.speed = 0;
    this.x = -1e9;
  }

  /**
   * Back to the state a train has before a run: doors shut, full length.
   * `despawn` leaves the doors and the car count as the last stop left
   * them, which is right between stations and wrong between RUNS, a short
   * train left in a slot made the next run's first layout read `short`
   * differently from a fresh page (the replay check found it).
   */
  reset() {
    this.despawn();
    this.doorFrac = 0;
    this.doorsOpen = false;
    this.arriveAt = 0;
    this.departAt = 0;
    this.setCars(this._stock.fullCars);
  }

  active() {
    return this.phase !== 'gone';
  }

  /** does world-x fall anywhere along the train? */
  overlaps(wx: number, pad = 0): boolean {
    return this.active() && wx > this.x - pad && wx < this.x + this.length + pad;
  }

  /** current opening width of any door */
  doorOpenWidth(): number {
    return C.DOOR_WIDTH * this.doorFrac;
  }

  /**
   * Can a body of radius r fit through a door opening at left-edge-relative x?
   * Door leaves slide in from the sides, so the passable column narrows as
   * they close, squeezing through late is meant to be possible but tight.
   */
  passableAtRel(rx: number, r: number): boolean {
    if (this.doorFrac <= 0) return false;
    for (const d of this.doors) {
      const c = (d.x0 + d.x1) / 2;
      const half = ((d.x1 - d.x0) / 2) * this.doorFrac;
      if (half * 2 < r * 1.6) continue;
      if (rx > c - half + r * 0.4 && rx < c + half - r * 0.4) return true;
    }
    return false;
  }

  passableAt(wx: number, r: number): boolean {
    return this.passableAtRel(wx - this.x, r);
  }

  /** solid wall at world-x for a body of radius r */
  solidAt(wx: number, r = 2): boolean {
    const rx = wx - this.x;
    if (rx < 0 || rx > this.length) return false;
    if (this.gaps.some((g) => rx >= g.x0 && rx <= g.x1)) return false;
    if (this.passableAtRel(rx, r)) return false;
    return true;
  }

  /** door opening at left-edge-relative x (regardless of open state) */
  doorAtRel(rx: number): boolean {
    return this.doors.some((d) => rx >= d.x0 && rx <= d.x1);
  }

  /** joint gap index at world-x, or -1 */
  gapIndexAt(wx: number): number {
    const rx = wx - this.x;
    return this.gaps.findIndex((g) => rx >= g.x0 && rx <= g.x1);
  }

  /** the unit body containing left-edge-relative x, or the nearest one */
  bodyAtRel(rx: number): Segment {
    const hit = this.bodies.find((b) => rx >= b.x0 && rx <= b.x1);
    if (hit) return hit;
    let best = this.bodies[0];
    let bestDist = Infinity;
    for (const b of this.bodies) {
      const d = Math.min(Math.abs(rx - b.x0), Math.abs(rx - b.x1));
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }
}
