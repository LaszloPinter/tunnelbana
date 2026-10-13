import Phaser from 'phaser';

/**
 * The wall the ads hang on, baked once as three repeating textures.
 *
 * The first attempt drew a coarse grid straight into the station's swept
 * Graphics, courses two and a half metres apart with five lines running
 * along, which read as a diagram of a wall rather than as a wall. Real
 * tunnelbana tiling is SMALL: hand-sized rectangles set on end, laid in
 * running bond so every other row steps half a tile across, and no two quite
 * the same shade.
 *
 * Drawing that per station is out of the question, a platform wall is 2700 by
 * 230 pixels, which is thousands of tiles, and Phaser's Graphics re-triangulates
 * its whole buffer every frame. So the pattern is baked to a texture once at
 * boot and repeated with a TileSprite, which costs one quad however big the
 * wall is. Each texture tiles seamlessly in both directions.
 *
 * Three walls, because the network has three kinds:
 *
 *   TILE, the shallow cut-and-cover halls, glazed rectangles on end in the
 *   blue-greys the fifties used by the mile.
 *
 *   ROCK, the blasted caverns of the deep lines, sprayed concrete over
 *   granite, all lumps and no grid. Baked in greys so a station can tint it
 *   its own colour, which on the blue line is the entire point.
 *
 *   CONCRETE, poured panels with a form joint every few metres and nothing
 *   else. Plenty of stations really are just this.
 *
 * Each is idempotent and yields to real artwork loaded under the same key.
 */

export const WALL_TILE = 'wall-tile';
export const WALL_ROCK = 'wall-rock';
export const WALL_CONCRETE = 'wall-concrete';

/** a small deterministic noise source, so a wall bakes the same every run */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const canvasFor = (scene: Phaser.Scene, key: string, w: number, h: number) => {
  if (scene.textures.exists(key)) return null;
  const tex = scene.textures.createCanvas(key, w, h);
  return tex ?? null;
};

/**
 * Glazed tile, set on end in running bond.
 *
 * The tile is taller than it is wide and small, about 20 by 40 centimetres at
 * the game's scale, and every other course steps half a tile across, which is
 * what stops a tiled wall reading as graph paper.
 */
function bakeTile(scene: Phaser.Scene) {
  // four courses by eight tiles: repeats cleanly, and the half-step lands back
  // on itself after two rows
  const tw = 9;
  const th = 18;
  const cols = 8;
  const rows = 4;
  const tex = canvasFor(scene, WALL_TILE, tw * cols, th * rows);
  if (!tex) return;
  const ctx = tex.getContext();
  const rand = rng(0x7a11e);
  // grout: the wall behind the tiles
  ctx.fillStyle = '#171a21';
  ctx.fillRect(0, 0, tw * cols, th * rows);
  for (let r = 0; r < rows; r++) {
    // running bond: every other course steps half a tile
    const offset = r % 2 === 0 ? 0 : tw / 2;
    for (let c = -1; c <= cols; c++) {
      const x = c * tw + offset;
      const y = r * th;
      // the blue-greys these walls were glazed in, never twice the same
      const l = 0.72 + rand() * 0.28;
      const rr = Math.round(96 * l);
      const gg = Math.round(112 * l);
      const bb = Math.round(134 * l);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(x + 0.5, y + 0.5, tw - 1.5, th - 1.5);
      // glaze: a lighter edge along the top of each tile
      ctx.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.07})`;
      ctx.fillRect(x + 0.5, y + 0.5, tw - 1.5, 2);
    }
  }
  tex.refresh();
}

/**
 * Sprayed concrete over blasted rock: lumps, shadow under each lump, and no
 * two the same. Baked in grey so the station can tint it.
 */
function bakeRock(scene: Phaser.Scene) {
  const w = 128;
  const h = 128;
  const tex = canvasFor(scene, WALL_ROCK, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const rand = rng(0xca5e);
  // baked LIGHT, because it gets tinted by the station's own colour on the
  // way in and a multiply only ever darkens: baked dark it came out black
  ctx.fillStyle = '#6c6c74';
  ctx.fillRect(0, 0, w, h);
  // lumps, drawn wrapped so the texture meets itself on every edge
  for (let i = 0; i < 190; i++) {
    const cx = rand() * w;
    const cy = rand() * h;
    const rx = 5 + rand() * 17;
    const ry = 4 + rand() * 11;
    const l = rand();
    for (const [dx, dy] of [
      [0, 0],
      [w, 0],
      [-w, 0],
      [0, h],
      [0, -h],
      [w, h],
      [-w, -h],
      [w, -h],
      [-w, h],
    ]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy + dy, rx, ry, rand() * 3.14, 0, Math.PI * 2);
      ctx.fillStyle =
        l > 0.55
          ? `rgba(${Math.round(190 + l * 50)},${Math.round(188 + l * 48)},${Math.round(196 + l * 50)},0.18)`
          : `rgba(24,22,28,${0.1 + l * 0.18})`;
      ctx.fill();
    }
  }
  tex.refresh();
}

/** poured panels: a form joint every few metres, and staining down from it */
function bakeConcrete(scene: Phaser.Scene) {
  const w = 96;
  const h = 96;
  const tex = canvasFor(scene, WALL_CONCRETE, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const rand = rng(0xc0c4);
  ctx.fillStyle = '#33353c';
  ctx.fillRect(0, 0, w, h);
  // mottling, so a flat panel is not a flat fill
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.035})`;
    const s = 4 + rand() * 20;
    ctx.fillRect(rand() * w, rand() * h, s, s * 0.6);
  }
  // the form joint down one edge, and the stain that always runs from it
  ctx.fillStyle = 'rgba(12,12,16,0.55)';
  ctx.fillRect(0, 0, 2, h);
  ctx.fillStyle = 'rgba(12,12,16,0.16)';
  ctx.fillRect(2, 0, 5, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(w - 2, 0, 2, h);
  tex.refresh();
}

/** Bake all three. Idempotent, cheap, once before the first station is built. */
/**
 * A COLUMN, baked once. The roof columns were three filled octagons apiece
 * drawn into a Graphics, and Graphics is immediate mode: a station with
 * forty of them handed the renderer 2,700 commands to re-triangulate every
 * frame, on art that never changes (2026-09-05). One texture, placed as an
 * image per column, batches with every other image and costs nothing.
 */
export const COLUMN_IN = 'column-indoor';
export const COLUMN_OUT = 'column-outdoor';
/** the radius the texture is drawn at; an image is scaled from this */
export const COLUMN_R = 48;

function bakeColumn(scene: Phaser.Scene, key: string, mid: number, core: number) {
  const pad = Math.round(COLUMN_R * 1.3);
  const tex = canvasFor(scene, key, pad * 2, pad * 2);
  if (!tex) return;
  const ctx = tex.getContext();
  const oct = (rad: number, fill: string) => {
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = pad + Math.cos(a) * rad;
      const y = pad + Math.sin(a) * rad;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
  oct(COLUMN_R * 1.3, 'rgba(17,19,26,0.55)');
  oct(COLUMN_R, hex(mid));
  oct(COLUMN_R * 0.6, hex(core));
  tex.refresh();
}

export function bakeWallArt(scene: Phaser.Scene) {
  bakeTile(scene);
  bakeRock(scene);
  bakeConcrete(scene);
  bakeColumn(scene, COLUMN_IN, 0x4a5058, 0x5d646e);
  bakeColumn(scene, COLUMN_OUT, 0x6a6f79, 0x878d98);
}
