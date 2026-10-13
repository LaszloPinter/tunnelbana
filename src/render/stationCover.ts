import type Phaser from 'phaser';
import * as C from '../config.ts';
import type { StationCtx } from './stationBuilder.ts';

/**
 * HOW FAR A STATION'S PICTURE MAY RUN PAST ITS PLATFORM END: `px` at a
 * terminus, and NOTHING where a leg leaves that end. From the mouth on, the
 * leg owns the floor, the walls and the backdrop (render/mapBore.ts), and it
 * draws them from its own curve.
 *
 * ONE rule, because it was four. The bed, the accent band, the wall and the
 * backdrop each ran out past the end by its own margin, each with its own
 * copy of the exception, and the backdrop's copy only knew about OPEN legs.
 * So at every bored mouth a near-black rectangle eight metres long stood
 * over the tunnel's lit floor, a full hall tall, as a black band between the
 * station and its bore (from play 2026-09-13, Fridhemsplan's lower storey;
 * the debug overlay showed the walkable floor running straight through it).
 */
export function pastMouth(ctx: StationCtx, side: -1 | 1, px: number): number {
  return (side < 0 ? ctx.boreL : ctx.boreR) ? 0 : px;
}

/**
 * What lies beyond the platform: the backdrop, rock below ground, sky and
 * trees above it. The DARK is not drawn here: a station lights its own
 * platform and nothing else, and the tunnel's roof belongs to the leg
 * (src/render/tunnelArt.ts drawGloom), so the light is the same fixed
 * picture whether you stand on this platform or see it down a bore.
 */
export function dressCover(
  ctx: StationCtx,
  D: Phaser.GameObjects.GameObject[],
  platformX0: number,
  platformX1: number,
  outdoor: boolean,
  rng: () => number,
) {
  const span = platformX1 - platformX0;
  // station-area backdrop: open sky vs rock. Only the platform and a step
  // past each end at a terminus; the LEG draws its own sky or rock beyond a
  // mouth (pastMouth above)
  const stepL = pastMouth(ctx, -1, outdoor ? C.M(4) : C.M(8));
  const stepR = pastMouth(ctx, 1, outdoor ? C.M(4) : C.M(8));
  D.push(
    ctx.scene.add
      .rectangle(
        (platformX0 - stepL + platformX1 + stepR) / 2,
        (ctx.bedTop + ctx.bed2Bottom) / 2,
        span + stepL + stepR,
        ctx.bed2Bottom - ctx.bedTop + 2 * ctx.path.maxOffset + C.M(24),
        outdoor ? 0x2f3d47 : 0x0e0e13,
      )
      .setDepth(-0.5),
  );
  if (outdoor) {
    // trees beyond the tracks
    for (let i = 0; i < 14; i++) {
      const tx = platformX0 - C.M(6) + rng() * (span + C.M(12));
      const ty =
        (rng() < 0.5 ? ctx.bedTop - 24 - rng() * 30 : ctx.bed2Bottom + 24 + rng() * 30) +
        ctx.path.offsetAt(tx);
      D.push(
        ctx.scene.add
          .circle(tx, ty, 7 + rng() * 8, 0x2e5d3a)
          .setDepth(-0.3)
          .setAlpha(0.9),
      );
    }
  }
}
