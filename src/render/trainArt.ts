import Phaser from 'phaser';
import * as C from '../config.ts';
import { STOCK, Train, type Stock } from '../core/train.ts';
import { pieceSpans, type PieceKind } from '../core/trainPieces.ts';
export type { PieceKind };

/**
 * Procedural open-top ("dollhouse cutaway") view of a C20-style train.
 * The visual language: because the real car's walls are tilted/curved
 * (tumblehome), a cutaway shows them as a BAND with thickness, not a line; the
 * shell has rounded ends with a tapered blue nose; windows read edge-on as
 * light segments inside the wall band; the articulation between units is a
 * bellows. Hand-drawn sprites can later replace these textures without
 * touching any game code.
 *
 * The art is drawn as one continuous train (seats, windows and the shell run
 * across car boundaries) but baked as one texture PER PIECE, six cars plus
 * the bellows between the units, so every car is its own game object that can
 * be positioned, and later rotated, along a curved platform centreline.
 */

export interface TrainPiece {
  kind: PieceKind;
  /** device pixels per layout unit this texture was baked at */
  res: number;
  /** car index along the whole train, or joint index between units */
  index: number;
  /** texture key */
  key: string;
  /** integer left offset of this piece from the train's left edge */
  a: number;
  /** integer width; pieces tile the train end to end without gaps */
  w: number;
}

/** drawing height: the shell plus a couple of px of bleed */
const PIECE_H = C.CAR_WIDTH + 6;

/**
 * Bake one texture per car (and per bellows) for a train facing `doorSide`.
 * Pieces are cut on integer layout columns and drawn by rendering the WHOLE
 * train offset so that the piece's span lands on the texture, so the seam
 * between two pieces is exactly the seam of the old single baked texture.
 *
 * `res` is device pixels per layout unit: the art is baked at the screen's
 * resolution and drawn back down at 1/res, so the train is as sharp as the
 * shapes around it instead of being magnified by the camera zoom.
 */
export function buildTrainPieces(
  scene: Phaser.Scene,
  doorSide: 1 | -1,
  res = 1,
  stock: Stock = STOCK.c20,
  /** car sections: a kort tåg is baked as its own train, so it has a cab at
   * BOTH ends, cutting the full train's art short left its front an open
   * mid-section, which is not a thing that arrives at a platform */
  cars = stock.fullCars,
): TrainPiece[] {
  // geometry only: the art depends on which side the doors face and where the
  // stock puts its couplings, never on which way the train is travelling
  const train = new Train(0, 1, doorSide, stock);
  train.setCars(cars);
  // walk the train in order: the cars of each body, then the coupling after it
  const spans = pieceSpans(train);

  const pieces: TrainPiece[] = [];
  // the drawing is centred on the texture so a piece placed at its car's
  // centreline sits exactly there, whatever the bake resolution rounds to
  const texH = Math.ceil(PIECE_H * res);
  // A CAR LIES ON ITS CHORD, and on a curve two chords meet at an angle:
  // a wedge of nothing opened at the joint on the outside of every bend
  // (from play 2026-09-25: "gaps on the train between cars"). Each car is
  // baked a little INTO its car neighbours, the art is continuous there,
  // it is the same shell, so the neighbour's extension fills the wedge.
  // Never into a coupling: the bellows is a real gap and stays one.
  const PAD = Math.round(C.M(0.6));
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const padL = s.kind === 'car' && i > 0 && spans[i - 1].kind === 'car' ? PAD : 0;
    const padR = s.kind === 'car' && i + 1 < spans.length && spans[i + 1].kind === 'car' ? PAD : 0;
    const a = Math.round(s.x0) - padL;
    const w = Math.round(s.x1) + padR - a;
    const key = `train-${stock.id}-c${cars}-side${doorSide}-${s.kind}${s.index}`;
    pieces.push({ kind: s.kind, index: s.index, key, a, w, res });
    if (scene.textures.exists(key)) continue;
    const g = scene.add.graphics();
    // everything drawn after this is res times bigger and lands `a` to the
    // left, so the piece's own span is what the texture captures; the rest of
    // the train is clipped away by the texture's edges
    g.scaleCanvas(res, res);
    g.translateCanvas(-a, 0);
    drawTrain(g, train, texH / (2 * res));
    // a hair of overlap rather than a hairline gap between neighbours
    g.generateTexture(key, Math.ceil(w * res), texH);
    g.destroy();
  }
  return pieces;
}

/** the whole train, in left-edge-relative coordinates, centred on `cy` */
function drawTrain(g: Phaser.GameObjects.Graphics, train: Train, cy: number) {
  const L = train.length;
  const halfW = C.CAR_WIDTH / 2;
  const wallT = C.M(0.3);

  const SHELL = 0xc9d0d7;
  const OUTLINE = 0x59636e;
  const FLOOR = 0x8e939a;
  const AISLE = 0x999ea6;
  const BLUE = 0x1f78c8;
  const SEAT = 0x2456a0;
  const SEAT_BACK = 0x1a3f78;
  const GLASS = 0xb7d4e6;
  const DARK = 0x14171b;
  const CAB_FLOOR = 0x6a7076;

  // --- articulation bellows (under the bodies) ---
  for (const gp of train.gaps) {
    g.fillStyle(DARK, 1);
    g.fillRect(gp.x0 - 4, cy - (halfW - 7), gp.x1 - gp.x0 + 8, C.CAR_WIDTH - 14);
    g.fillStyle(0x3a4048, 1);
    const folds = 4;
    const fw = (gp.x1 - gp.x0) / (folds * 2);
    for (let i = 0; i < folds; i++) {
      g.fillRect(gp.x0 + i * 2 * fw + fw / 2, cy - (halfW - 9), fw, C.CAR_WIDTH - 18);
    }
  }

  // --- unit shells with rounded ends; nose corners get the big radius ---
  const noseR = C.M(1.15);
  for (let bi = 0; bi < train.bodies.length; bi++) {
    const b = train.bodies[bi];
    const isFront = bi === 0;
    const isBack = bi === train.bodies.length - 1;
    const rad = {
      tl: isFront ? noseR : 6,
      bl: isFront ? noseR : 6,
      tr: isBack ? noseR : 6,
      br: isBack ? noseR : 6,
    };
    g.fillStyle(SHELL, 1);
    g.fillRoundedRect(b.x0, cy - halfW, b.x1 - b.x0, C.CAR_WIDTH, rad);
    g.lineStyle(2.5, OUTLINE, 1);
    g.strokeRoundedRect(b.x0 + 1, cy - halfW + 1, b.x1 - b.x0 - 2, C.CAR_WIDTH - 2, rad);
    // interior floor inset by the wall band
    g.fillStyle(FLOOR, 1);
    g.fillRoundedRect(b.x0 + wallT, cy - halfW + wallT, b.x1 - b.x0 - 2 * wallT, C.CAR_WIDTH - 2 * wallT, {
      tl: Math.max(3, rad.tl - wallT),
      bl: Math.max(3, rad.bl - wallT),
      tr: Math.max(3, rad.tr - wallT),
      br: Math.max(3, rad.br - wallT),
    });
    // aisle sheen
    g.fillStyle(AISLE, 1);
    g.fillRect(b.x0 + wallT, cy - C.M(0.45), b.x1 - b.x0 - 2 * wallT, C.M(0.9));
  }

  // --- windows: light edge-on segments inside the wall band, between doors ---
  const cabZone = C.M(1.9);
  for (const b of train.bodies) {
    for (const side of [1, -1] as const) {
      const wy = side === 1 ? cy + halfW - wallT * 0.78 : cy - halfW + wallT * 0.22;
      // wall segments = body span minus door spans
      const cuts = train.doors
        .filter((d) => d.x0 >= b.x0 && d.x1 <= b.x1)
        .map((d) => [d.x0 - C.M(0.2), d.x1 + C.M(0.2)]);
      cuts.sort((a, c) => a[0] - c[0]);
      let segStart = Math.max(b.x0 + C.M(0.5), cabZone === 0 ? b.x0 : b.x0);
      const segs: [number, number][] = [];
      for (const [c0, c1] of cuts) {
        if (c0 - segStart > C.M(0.8)) segs.push([segStart, c0]);
        segStart = c1;
      }
      if (b.x1 - C.M(0.5) - segStart > C.M(0.8)) segs.push([segStart, b.x1 - C.M(0.5)]);
      g.fillStyle(GLASS, 1);
      for (const [s0, s1] of segs) {
        // keep windows out of the train's two cab noses
        const w0 = Math.max(s0, cabZone);
        const w1 = Math.min(s1, L - cabZone);
        if (w1 - w0 > C.M(0.6)) g.fillRect(w0, wy - wallT * 0.22, w1 - w0, wallT * 0.44);
      }
    }
  }

  // --- door openings, baked SHUT on both sides. A train only has moving doors
  // while it is standing at a platform, so the leaves are game objects only
  // then; the rest of the time, arriving, leaving, running through, the
  // texture is the whole door and nothing has to be drawn per door at all.
  for (const d of train.doors) {
    for (const side of [1, -1] as const) {
      const yTop = side === 1 ? cy + halfW - wallT : cy - halfW;
      g.fillStyle(FLOOR, 1);
      g.fillRect(d.x0, yTop, d.x1 - d.x0, wallT);
      g.fillStyle(BLUE, 1);
      g.fillRect(d.x0, side === 1 ? cy + halfW - 8 : cy - halfW, d.x1 - d.x0, 8);
    }
  }

  // --- gangway bulkheads at car boundaries (open center, per the ritning) ---
  g.fillStyle(SHELL, 1);
  for (const b of train.bodies) {
    for (let car = 1; car < C.CARS_PER_UNIT; car++) {
      const x = b.x0 + car * C.CAR_LENGTH;
      const stub = halfW - wallT - C.M(0.75);
      g.fillRect(x - 2, cy - halfW + wallT, 4, stub);
      g.fillRect(x - 2, cy + halfW - wallT - stub, 4, stub);
    }
  }

  // --- THE UNIT ENDS: a solid wall, plainly drawn. A C20 is sealed units
  // (world/metal.ts unitAt) and the bellows between them read as a gangway:
  // "something invisible is blocking me on the long train" (from play
  // 2026-10-11). A full-width end wall with a yellow edge says "no way through".
  for (let bi = 0; bi < train.bodies.length; bi++) {
    const b = train.bodies[bi];
    const ends: number[] = [];
    if (bi > 0) ends.push(b.x0 + wallT);
    if (bi < train.bodies.length - 1) ends.push(b.x1 - wallT - 6);
    for (const x of ends) {
      g.fillStyle(SHELL, 1);
      g.fillRect(x, cy - halfW + wallT, 6, C.CAR_WIDTH - 2 * wallT);
      g.fillStyle(0xe8c23a, 1);
      g.fillRect(x + (bi > 0 && x === b.x0 + wallT ? 6 : -2), cy - halfW + wallT, 2, C.CAR_WIDTH - 2 * wallT);
    }
  }

  // --- seats: facing 2+2 bays, or a bench run along the wall ---
  for (const s of train.seats) {
    if (s.bench) {
      // a C30 bench: one cushion the length of the run, its back to the
      // window, everyone aboard facing across the aisle at everyone else
      const wallSide = s.y0 > 0 ? 1 : -1;
      g.fillStyle(SEAT, 1);
      g.fillRoundedRect(s.x0 + 2, cy + s.y0, s.x1 - s.x0 - 4, s.y1 - s.y0, 3);
      g.fillStyle(SEAT_BACK, 1);
      const backY = wallSide === 1 ? cy + s.y1 - 2.5 : cy + s.y0;
      g.fillRect(s.x0 + 2, backY, s.x1 - s.x0 - 4, 2.5);
      // the gaps between cushions, so it does not read as one slab
      g.fillStyle(0x000000, 0.18);
      for (let sx = s.x0 + C.M(1.05); sx < s.x1 - C.M(0.4); sx += C.M(1.05)) {
        g.fillRect(sx, cy + s.y0 + 1, 1.5, s.y1 - s.y0 - 2);
      }
      continue;
    }
    const rowW = C.M(0.5);
    const centers = s.x1 - s.x0 >= C.M(1.6) ? [s.x0 + rowW / 2, s.x1 - rowW / 2] : [(s.x0 + s.x1) / 2];
    for (let i = 0; i < centers.length; i++) {
      const rx = centers[i];
      g.fillStyle(SEAT, 1);
      g.fillRoundedRect(rx - rowW / 2, cy + s.y0, rowW, s.y1 - s.y0, 2);
      // backrest on the outward-facing edge of each row (they face each other)
      g.fillStyle(SEAT_BACK, 1);
      const backX = centers.length === 1 ? rx - rowW / 2 : i === 0 ? rx - rowW / 2 : rx + rowW / 2 - 2.5;
      g.fillRect(backX, cy + s.y0, 2.5, s.y1 - s.y0);
    }
  }

  // --- stroller/wheelchair bays: floor outline marking ---
  g.lineStyle(1.5, 0x6f7d8c, 0.9);
  const wallIn = halfW - 3;
  for (const fx of train.flexAreas) {
    const fy = fx.side * (wallIn - C.M(0.45));
    g.strokeRoundedRect(fx.x0 + 2, cy + fy - C.M(0.45), fx.x1 - fx.x0 - 4, C.M(0.9), 3);
  }

  // --- cabs: darker floor, console, and the blue nose cap over everything ---
  for (const end of [0, 1] as const) {
    const x0 = end === 0 ? wallT : L - cabZone;
    const x1 = end === 0 ? cabZone : L - wallT;
    g.fillStyle(CAB_FLOOR, 1);
    g.fillRoundedRect(x0, cy - halfW + wallT, x1 - x0, C.CAR_WIDTH - 2 * wallT, 4);
    // cab bulkhead with center door gap
    g.fillStyle(SHELL, 1);
    const bx = end === 0 ? cabZone : L - cabZone;
    const stub = halfW - wallT - C.M(0.55);
    g.fillRect(bx - 2, cy - halfW + wallT, 4, stub);
    g.fillRect(bx - 2, cy + halfW - wallT - stub, 4, stub);
    // console strip against the nose
    g.fillStyle(0x3c454e, 1);
    const consX = end === 0 ? wallT + 2 : L - wallT - 2 - C.M(0.35);
    g.fillRect(consX, cy - C.M(0.9), C.M(0.35), C.M(1.8));
    // blue nose cap
    g.fillStyle(BLUE, 1);
    if (end === 0) {
      g.fillRoundedRect(0, cy - halfW, C.M(0.95), C.CAR_WIDTH, { tl: noseR, bl: noseR, tr: 0, br: 0 });
    } else {
      g.fillRoundedRect(L - C.M(0.95), cy - halfW, C.M(0.95), C.CAR_WIDTH, {
        tr: noseR,
        br: noseR,
        tl: 0,
        bl: 0,
      });
    }
  }
}
