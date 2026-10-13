import type { Train } from './train.ts';

export type PieceKind = 'car' | 'joint';

/**
 * HOW A TRAIN IS CUT INTO PIECES: the cars of each body in order, and the
 * coupling between one body and the next.
 *
 * One definition, because three things depend on being cut the same way: the
 * art bakes a texture per piece (render/trainArt.ts), the map stands each
 * piece on its own stretch of the line (render/mapMetal.ts), and a seat is
 * held by the piece it is IN (world/trains2d.ts). Cut differently by any one
 * of them and whoever is aboard sits outside the car they are riding.
 */
export function pieceSpans(train: Train): { kind: PieceKind; index: number; x0: number; x1: number }[] {
  const out: { kind: PieceKind; index: number; x0: number; x1: number }[] = [];
  let ci = 0;
  train.bodies.forEach((b, u) => {
    while (ci < train.cars.length && train.cars[ci].x1 <= b.x1 + 0.01) {
      out.push({ kind: 'car', index: ci, x0: train.cars[ci].x0, x1: train.cars[ci].x1 });
      ci += 1;
    }
    if (u < train.gaps.length)
      out.push({ kind: 'joint', index: u, x0: train.gaps[u].x0, x1: train.gaps[u].x1 });
  });
  return out;
}
