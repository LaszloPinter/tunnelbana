import Phaser from 'phaser';
import * as C from '../config.ts';
import { AD_COLORS, AD_TEXTS, PANEL_WORDS, WIDE_ADS } from '../core/lineData.ts';
import { addLabel, adBoardKey, adPanelKey, adWideKey, fitLabel } from './labelArt.ts';
import type { Palette } from '../data/stationPalette.ts';
import type { StationCtx } from './stationBuilder.ts';
import { pastMouth } from './stationCover.ts';
import { WALL_CONCRETE, WALL_ROCK, WALL_TILE } from './wallArt.ts';

/** the walls the ads hang on, faced by how the station was dug, and the ads
 * in their real formats: wide boards, rows of eurosize panels, the stortavla */
export function dressWalls(
  ctx: StationCtx,
  D: Phaser.GameObjects.GameObject[],
  platformX0: number,
  platformX1: number,
  palette: Palette,
  rng: () => number,
) {
  // The wall the ads hang on, and what it is faced with.
  //
  // The first cut drew a coarse grid, courses two and a half metres apart,
  // which read as a diagram of a wall rather than as a wall. Real
  // tunnelbana tiling is small rectangles set on end in running bond, far
  // too many to draw per station, so the three facings are baked once at
  // boot and repeated with a TileSprite: one quad however long the
  // platform is (see wallArt.ts).
  //
  // Which facing is not a guess. A blasted cavern has no tiling because it
  // has no flat wall to tile, and depth is what decides that: the blue
  // line is bored end to end, and so is anything three storeys down. The
  // shallow cut-and-cover halls are glazed tile. Everything else is what
  // plenty of the network actually is, a poured concrete wall.
  const wallH = C.M(13);
  // ...and no further than the mouth, where the leg takes the wall over
  const wallX0 = platformX0 - pastMouth(ctx, -1, C.M(8));
  const wallX1 = platformX1 + pastMouth(ctx, 1, C.M(8));
  const first = ctx.platforms[0];
  const last = ctx.platforms[ctx.platforms.length - 1];
  const walls = [
    { top: ctx.bedTop - wallH, bottom: ctx.bedTop, color: first?.color },
    { top: ctx.bed2Bottom, bottom: ctx.bed2Bottom + wallH, color: last?.color },
  ];
  // The station's colour, laid over whichever facing it has. A tint only
  // ever multiplies, so a sprayed cavern, which is baked light for the
  // purpose, takes it full strength, while glazed tile takes it halfway
  // to white: enough that Thorildsplan and Odenplan are not the same wall,
  // not so much that the tile stops looking glazed.
  const wash = palette.wash;
  const pale = (c: number, k: number) => {
    const up = (v: number) => Math.round(v + (255 - v) * k);
    return (up((c >> 16) & 0xff) << 16) | (up((c >> 8) & 0xff) << 8) | up(c & 0xff);
  };
  // 0.5 washed every tiled hall to within a hex of the next one; a third
  // still keeps the glaze while letting the station's own colour show
  const tileWash = pale(wash, 0.3);
  for (const w of walls) {
    // depth decides the facing, except where the palette knows better
    const facing =
      palette.facing ??
      (w.color === 'blue' || ctx.storey <= -3 ? 'rock' : w.color === 'green' ? 'tile' : 'concrete');
    const bored = facing === 'rock';
    const key = bored ? WALL_ROCK : facing === 'tile' ? WALL_TILE : WALL_CONCRETE;
    const midWall = (w.top + w.bottom) / 2;
    // a straight station is one tile sprite; a curved one is sliced so the
    // facing follows the platform it is behind
    // enough slices that the steps between them do not notch the wall's
    // own edges on a strong curve
    const slices = ctx.path.flat ? 1 : 40;
    const sw = (wallX1 - wallX0) / slices;
    for (let i = 0; i < slices; i++) {
      const sx = wallX0 + i * sw;
      const cx = sx + sw / 2;
      const ts = ctx.scene.add
        .tileSprite(cx, midWall + ctx.path.offsetAt(cx), sw + 1, wallH, key)
        .setDepth(-0.45);
      // anchor the pattern to world x so it runs unbroken across slices
      ts.tilePositionX = sx;
      ts.setTint(bored ? wash : tileWash);
      D.push(ts);
    }
  }
  // ads in their real formats: wide movie-screen boards, rows of five
  // vertical eurosize panels, and the classic stortavla
  for (let ax = platformX0 + C.M(10); ax < platformX1 - C.M(10); ax += C.M(19)) {
    const ao = ctx.path.offsetAt(ax);
    for (const ay of [ctx.bedTop - C.M(2.9) + ao, ctx.bed2Bottom + C.M(2.9) + ao]) {
      const roll = rng();
      if (roll < 0.18) continue;
      if (roll < 0.46) {
        // wide screen: one long board, one long line
        const wtxt = WIDE_ADS[Math.floor(rng() * WIDE_ADS.length)];
        D.push(
          ctx.scene.add
            .rectangle(ax, ay, C.M(14), C.M(3.6), 0x14171d)
            .setDepth(-0.3)
            .setStrokeStyle(4, 0xd8d8e0)
            .setAlpha(0.94),
          fitLabel(addLabel(ctx.scene, ax, ay, adWideKey(wtxt)).setDepth(-0.25), C.M(13.2), C.M(3)),
        );
      } else if (roll < 0.75) {
        // five vertical panels shoulder to shoulder
        for (let k = -2; k <= 2; k++) {
          const col = AD_COLORS[Math.floor(rng() * AD_COLORS.length)];
          const word = PANEL_WORDS[Math.floor(rng() * PANEL_WORDS.length)];
          const px = ax + k * C.M(2.1);
          D.push(
            ctx.scene.add
              .rectangle(px, ay, C.M(1.75), C.M(3.1), col)
              .setDepth(-0.3)
              .setStrokeStyle(3, 0xd8d8e0)
              .setAlpha(0.9),
            // turned on its side, so its box is the panel's height by its width
            fitLabel(
              addLabel(ctx.scene, px, ay, adPanelKey(word)).setDepth(-0.25).setAngle(-90),
              C.M(2.9),
              C.M(1.5),
            ),
          );
        }
      } else {
        // classic stortavla
        const col = AD_COLORS[Math.floor(rng() * AD_COLORS.length)];
        const [l1, l2] = AD_TEXTS[Math.floor(rng() * AD_TEXTS.length)];
        D.push(
          ctx.scene.add
            .rectangle(ax, ay, C.M(6.5), C.M(4), col)
            .setDepth(-0.3)
            .setStrokeStyle(4, 0xd8d8e0)
            .setAlpha(0.92),
          fitLabel(addLabel(ctx.scene, ax, ay, adBoardKey(l1, l2)).setDepth(-0.25), C.M(5.8), C.M(3.4)),
        );
      }
    }
  }
}
