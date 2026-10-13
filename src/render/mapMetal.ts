import Phaser from 'phaser';
import * as C from '../config.ts';
import { trainBody, trainCars } from '../world/trains2d.ts';
import { doorNormalOf } from '../world/metal.ts';
import { buildTrainPieces, type TrainPiece } from './trainArt.ts';
import { MapDoors } from './mapDoors.ts';
import { HeadlightView } from './lightAndDark.ts';
import * as DEPTH from './depth.ts';
import { STOCK, Train } from '../core/train.ts';
import { addLabel, signKey } from './labelArt.ts';
import { isShortTrain, journeyById } from '../core/fleet.ts';
import type { Run } from '../sim/run.ts';

/** what the camera can see, in world coordinates */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * THE TRAINS ON THE MAP, every one of them, every frame, and nothing else.
 *
 * Split out of render/mapView.ts, which draws the GROUND: the floor, the
 * furniture and the tunnel's dark are a picture of a world that only changes
 * when the world does, and the metal is a picture of something moving. They
 * were one class because they shared a camera box; that is not a reason.
 */
export class MapMetal {
  /** one image per car, per train: the body follows the line because it is a
   * string of cars, each on its own stretch of it */
  private readonly cars = new Map<
    string,
    {
      key: string;
      imgs: Phaser.GameObjects.Image[];
      /** THE DESTINATION SIGNS: one per body, on its window band a car in
       * from its end, the old per-room train had them and the map's did
       * not (from play 2026-09-25: "the trains used to have their
       * destination labels"). Baked per service and terminus (labelArt.ts) */
      signs: { img: Phaser.GameObjects.Image; along: number }[];
    }
  >();
  /** the leaves, for whichever train is standing with its doors moving */
  private readonly doors: MapDoors;
  /** the beam off its nose, the station view's own art (lightAndDark.ts),
   * which is a light ON TOP of the tunnel's dark, because that is the point */
  private readonly lights: HeadlightView;
  private cam: Box | null = null;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.doors = new MapDoors(scene);
    this.lights = new HeadlightView(scene);
  }

  /** ...and is any PART of a train? its own box against the camera's */
  private seesTrain(seat: (along: number) => { x: number; y: number } | null, len: number): boolean {
    const c = this.cam;
    if (!c) return true;
    const pad = C.CAR_WIDTH;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    // ...to the NOSE as well: stepping by a car stops short of it by up to a
    // car, and a train coming on at the edge showed up a car late
    for (let a = 0; a < len + C.CAR_LENGTH; a += C.CAR_LENGTH) {
      const p = seat(Math.min(a, len));
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (x0 === Infinity) return false;
    return x1 + pad > c.x0 && x0 - pad < c.x1 && y1 + pad > c.y0 && y0 - pad < c.y1;
  }

  /**
   * THE TRAINS, every frame, from the journeys themselves, and drawn with
   * the art they have always had.
   *
   * A train's picture is baked one texture PER CAR (render/trainArt.ts), and
   * a car is fifteen metres of a curve that bends about a degree a metre, so
   * a car laid flat along the line is straight to well under its own width.
   * That is the whole trick: the body follows the tunnel because it is a
   * string of cars, each standing where its own stretch of line is and facing
   * the way that stretch faces. Nothing had to be redrawn for the map.
   */
  draw(run: Run, now: number, cam: Box | null) {
    this.cam = cam;
    const live = new Set<string>();
    this.doors.clear();
    this.lights.clear();
    for (const jid of run.metalNear(0, 0)) {
      const j = journeyById(jid);
      const seat = j && trainCars(jid, now);
      if (!j || !seat) continue;
      const body = trainBody(jid, now);
      // ...AND NOT A TRAIN ON ANOTHER FLOOR OF THIS PLACE. A stacked
      // station's storeys stand at the same point on the map, that is what
      // makes them one station, so the tube below runs across the hall you
      // are in. The floor asks the same question of the same metal
      // (src/world/metal.ts sameStorey).
      const mid = seat(C.M(70));
      if (mid && !run.sameStorey(jid, mid.x, mid.y)) continue;
      live.add(jid);
      // ...and only the metal you could see: a train at the next station is
      // at THAT station's bearing, and drawn anyway it crosses this platform
      // diagonally (from play 2026-09-10).
      // ...AND ONLY THE METAL YOU COULD SEE, asked of the whole train, not
      // of three points along it. A train is a hundred and forty metres laid
      // on a curve, and the camera turns with the track: sampling it at nought,
      // seventy and a hundred and forty metres misses a train whose middle is
      // plainly on screen while all three marks are off it, so it vanished and
      // came back as the view moved (from play 2026-09-11: "trains blink").
      if (!this.seesTrain(seat, body?.len ?? C.M(140))) {
        // ...and a train not drawn must not be LEFT drawn: its images keep
        // their last pose, so an off-camera train stood wherever the view
        // last saw it (from play: "trains don't follow their path")
        const hidden = this.cars.get(jid);
        hidden?.imgs.forEach((i) => i.setVisible(false));
        hidden?.signs.forEach((sg) => sg.img.setVisible(false));
        continue;
      }
      const stock = j.service.color === 'red' ? STOCK.c30 : STOCK.c20;
      const cars = isShortTrain(jid) ? stock.shortCars : stock.fullCars;
      // THE SIDE THE DOORS ARE ON, in the train's own heading (world/metal.ts)
      const side = doorNormalOf(run, jid, now);
      // the geometry of a train's art is a fact about its stock, its length
      // and its door side: built once per kind, not once per train per frame
      const kind = `${stock.id}:${cars}:${side}`;
      let pieces = pieceCache.get(kind);
      if (!pieces) pieceCache.set(kind, (pieces = buildTrainPieces(this.scene, side, 2, stock, cars)));
      let row = this.cars.get(jid);
      if (!row || row.key !== kind) {
        row?.imgs.forEach((i) => i.destroy());
        row?.signs.forEach((sg) => sg.img.destroy());
        // where each body's sign sits: a car in from the body's near end
        const ref = new Train(0, 1, side, stock);
        ref.setCars(cars);
        const key = signKey(j.service.id, j.terminus);
        row = {
          key: kind,
          signs: ref.bodies.map((b) => ({
            img: addLabel(this.scene, 0, 0, key).setDepth(DEPTH.ACTOR_MIN + 0.01),
            along: b.x0 + C.CAR_LENGTH,
          })),
          imgs: pieces.map((pc) =>
            this.scene.add
              .image(0, 0, pc.key)
              // A TRAIN MOVES, so it is an ACTOR and belongs above the
              // tunnel's dark, not under it with the floors and the walls
              // (render/depth.ts rule 3). Drawn at place depth it was blacked
              // out by the roof along with everyone riding in it.
              .setDepth(DEPTH.ACTOR_MIN)
              .setScale(1 / pc.res),
          ),
        };
        this.cars.set(jid, row);
      }
      pieces.forEach((pc, i) => {
        // A CAR LIES ON ITS CHORD, which is what a rigid body on a curve
        // does: it is held at its two ends and spans straight between them.
        // Standing each car at its own middle and turning it to the tangent
        // THERE is what a flexible ribbon would do, and it leaves neighbours
        // splayed apart wherever the line turns, a train drawn as a
        // staircase of cars (from play 2026-09-11). Taking the two ends
        // instead, every car shares its ends with its neighbours, so the
        // train is one body whatever the track does.
        const from = seat(pc.a);
        const to = seat(pc.a + pc.w);
        const img = row!.imgs[i];
        if (!from || !to) {
          img.setVisible(false);
          return;
        }
        img
          .setVisible(true)
          .setPosition((from.x + to.x) / 2, (from.y + to.y) / 2)
          .setRotation(Math.atan2(to.y - from.y, to.x - from.x));
      });
      for (const sg of row.signs) {
        const at = seat(sg.along);
        const a1 = seat(Math.max(0, sg.along - C.M(2)));
        const a2 = seat(Math.min(body?.len ?? sg.along, sg.along + C.M(2)));
        if (!at || !a1 || !a2) {
          sg.img.setVisible(false);
          continue;
        }
        // A SIGN IS READ, so it never stands upside down on the SCREEN: turned
        // with its track it did on every train running right-to-left, read
        // as "grobsroN 31" (from the alpha UX pass, 2026-09-30). The screen
        // turns with the view (world/bearing.ts), so it is judged there.
        let turn = Math.atan2(a2.y - a1.y, a2.x - a1.x);
        // (the camera's `rotation` getter exists at runtime; Phaser 4's types omit it)
        const view = (this.scene.cameras.main as unknown as { rotation: number }).rotation;
        if (Math.cos(turn + view) < 0) turn += Math.PI;
        sg.img.setVisible(true).setPosition(at.x, at.y).setRotation(turn);
      }
      // ...and the beam off the nose, which is always the high end: a line's
      // arc runs the way its trains do, so the tail is always the low one
      if (body) {
        const nose = seat(body.len);
        const back = seat(body.len - C.CAR_LENGTH);
        // dimmed right down beside a lit platform, where it only washes the
        // place out, the map knows which kind of ground the nose is over
        const inTunnel = !nose || run.map.at(nose.x, nose.y)?.kind !== 'platform';
        // A LAMP POINTS WHERE THE TRAIN IS FACING, not along the track ahead.
        // Asking the LINE where a point 26 m in front is sends the beam round
        // the bend while the cab it is bolted to is still pointing straight,
        // so the light swung off the nose and led the train through curves
        // (from play 2026-09-11: "the lights live their own life looking
        // ahead of the curve, not fixed forward like real life lights").
        const ahead = nose && back ? aim(back, nose) : null;
        if (nose && ahead)
          this.lights.beam(
            body.speed,
            1,
            body.len,
            (a) => ({ x: nose.x + ahead.x * (a - body.len), y: nose.y + ahead.y * (a - body.len) }),
            inTunnel,
          );
      }
      // ...and the leaves on top, which are the only part of a train that
      // moves without the train moving
      this.doors.draw(run, jid, now, seat);
    }
    for (const [jid, row] of this.cars) {
      if (live.has(jid)) continue;
      row.imgs.forEach((i) => i.destroy());
      row.signs.forEach((sg) => sg.img.destroy());
      this.cars.delete(jid);
    }
  }

  destroy() {
    for (const row of this.cars.values()) {
      row.imgs.forEach((i) => i.destroy());
      row.signs.forEach((sg) => sg.img.destroy());
    }
    this.cars.clear();
  }
}

/** a train's pieces by kind (render/trainArt.ts); the textures behind them
 * are cached by the art itself, this is the geometry */
const pieceCache = new Map<string, TrainPiece[]>();

/** the way the leading car is pointing: its own chord, which is the angle it
 * is drawn at */
function aim(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / l, y: dy / l };
}
