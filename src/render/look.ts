/**
 * WHAT A COMMUTER LOOKS LIKE, chosen by the player on the landing (ui/dom/
 * avatar.ts), kept in their prefs, drawn by the rig in the game
 * (render/playerRig.ts) and by the preview on the page (drawLook below).
 * Purely a picture: nothing here is simulation state, so Math.random is fine.
 *
 * Top-down, GTA2-style: you see the top of a head in the middle of a pair
 * of shoulders. Long hair and a ponytail fall down the back; the build is
 * how broad the shoulders are.
 */
export type HairStyle = 'short' | 'buzz' | 'long' | 'ponytail' | 'bun';
export type Hat = 'none' | 'beanie' | 'cap';
export type Build = 'slim' | 'regular' | 'broad';

export interface PlayerLook {
  skin: number;
  top: number;
  trousers: number;
  hair: number;
  hairStyle: HairStyle;
  hat: Hat;
  hatColor: number;
  headphones: boolean;
  build: Build;
}

export const PALETTE = {
  skin: [0xf5dcc4, 0xe8c9a0, 0xd4a878, 0xa87c50, 0x8a5c38, 0x5e3c24],
  hair: [
    0x1c1a20, 0x2c2018, 0x584030, 0x7a3c28, 0xb89860, 0xe8dcb0, 0x88807a, 0xf07ab0, 0xb088e0, 0x5a8ae0,
    0x4fb89a, 0xc8402c,
  ],
  top: [
    0x9a4a42, 0xd6584f, 0xf28cb8, 0xe0508e, 0xc49be8, 0x7a5aa0, 0x3f6e94, 0x8cc4f0, 0x4f8a58, 0x8fd6b4,
    0xe8c23a, 0xf4b39a, 0xe8e4dc, 0x5a606c, 0x2a2c34, 0x8a6a50,
  ],
  trousers: [0x2e3442, 0x46648c, 0x3a3430, 0x403c36, 0x6a6e78, 0xd9cdb8, 0xf2a6c8, 0x5a3c6e, 0x1e1e24],
  hatColor: [
    0x8a3038, 0xe0508e, 0xf28cb8, 0xc49be8, 0x30506e, 0x8cc4f0, 0x3c3c44, 0xe8e4dc, 0x5e4a2e, 0x2e5444,
  ],
};
export const HAIR_STYLES: HairStyle[] = ['short', 'buzz', 'long', 'ponytail', 'bun'];
export const HATS: Hat[] = ['none', 'beanie', 'cap'];
export const BUILDS: Build[] = ['slim', 'regular', 'broad'];

/** shoulders, as a fraction of the regular build */
/** shoulders, as a fraction of the regular build, subtle: a crowd of very
 * small and very big people read as children and giants (from play 2026-10-10) */
export const BUILD_SCALE: Record<Build, number> = { slim: 0.93, regular: 1, broad: 1.07 };

/** a look rolled from any stream: Math.random for you, a seed for a passenger
 * (so every client draws the same stranger) */
export function lookFrom(rnd: () => number): PlayerLook {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  return {
    skin: pick(PALETTE.skin),
    top: pick(PALETTE.top),
    trousers: pick(PALETTE.trousers),
    hair: pick(PALETTE.hair),
    hairStyle: pick(HAIR_STYLES),
    hat: pick(['none', 'none', 'beanie', 'cap'] as const),
    hatColor: pick(PALETTE.hatColor),
    headphones: rnd() < 0.5,
    build: pick(BUILDS),
  };
}

export const randomLook = (): PlayerLook => lookFrom(Math.random);

/** YOUR look: the saved one, or one rolled now and saved, so the commuter
 * you meet on the landing is the one you play as */
export function myLook(load: () => PlayerLook | null, keep: (l: PlayerLook) => void): PlayerLook {
  const have = load();
  if (have) return have;
  const l = randomLook();
  keep(l);
  return l;
}

/** a look read back from storage: whatever is missing or strange, made sane */
export function saneLook(v: unknown): PlayerLook | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<PlayerLook>;
  const r = randomLook();
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    skin: num(o.skin, r.skin),
    top: num(o.top, r.top),
    trousers: num(o.trousers, r.trousers),
    hair: num(o.hair, r.hair),
    hairStyle: HAIR_STYLES.includes(o.hairStyle as HairStyle) ? (o.hairStyle as HairStyle) : r.hairStyle,
    hat: HATS.includes(o.hat as Hat) ? (o.hat as Hat) : r.hat,
    hatColor: num(o.hatColor, r.hatColor),
    headphones: typeof o.headphones === 'boolean' ? o.headphones : r.headphones,
    build: BUILDS.includes(o.build as Build) ? (o.build as Build) : r.build,
  };
}

export const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * THE SAME FIGURE ON A PAGE: a 2D-canvas drawing of the rig's shapes, facing
 * up, `u` pixels to the metre. It follows playerRig.ts piece for piece
 * (legs, the back hair, shoulders, fists, head, hat, headphones) so the
 * picture on the landing is the one you walk around as.
 */
export function drawLook(ctx: CanvasRenderingContext2D, look: PlayerLook, cx: number, cy: number, u: number) {
  const OUT = '#14151c';
  const b = BUILD_SCALE[look.build];
  ctx.save();
  ctx.translate(cx, cy);
  // the rig faces +x; the page wants it facing up
  ctx.rotate(-Math.PI / 2);
  const circle = (x: number, y: number, r: number, fill: number | string, line = 2) => {
    ctx.beginPath();
    ctx.arc(x * u, y * u, r * u, 0, Math.PI * 2);
    ctx.fillStyle = typeof fill === 'number' ? css(fill) : fill;
    ctx.fill();
    if (line) {
      ctx.lineWidth = line;
      ctx.strokeStyle = OUT;
      ctx.stroke();
    }
  };
  const ellipse = (x: number, y: number, w: number, h: number, fill: number, line = 2) => {
    ctx.beginPath();
    ctx.ellipse(x * u, y * u, (w / 2) * u, (h / 2) * u, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(fill);
    ctx.fill();
    if (line) {
      ctx.lineWidth = line;
      ctx.strokeStyle = OUT;
      ctx.stroke();
    }
  };
  const rect = (x: number, y: number, w: number, h: number, fill: number, line = 1.5) => {
    ctx.fillStyle = css(fill);
    ctx.fillRect((x - w / 2) * u, (y - h / 2) * u, w * u, h * u);
    if (line) {
      ctx.lineWidth = line;
      ctx.strokeStyle = OUT;
      ctx.strokeRect((x - w / 2) * u, (y - h / 2) * u, w * u, h * u);
    }
  };
  // shadow
  ctx.globalAlpha = 0.3;
  ellipse(0.06, 0.12, 1.2 * b, 0.98 * b, 0x05060c, 0);
  ctx.globalAlpha = 1;
  // legs and feet
  rect(-0.1, -0.2 * b, 0.52, 0.25, look.trousers);
  rect(-0.1, 0.2 * b, 0.52, 0.25, look.trousers);
  ellipse(0.14, -0.2 * b, 0.28, 0.22, 0x1e2026, 1.5);
  ellipse(0.14, 0.2 * b, 0.28, 0.22, 0x1e2026, 1.5);
  // body, shoulders, then the hair that lies over the back, forearms, fists
  const sy = 0.36 * b;
  ellipse(-0.14, 0, 0.7 * b, 0.86 * b, look.top);
  circle(-0.04, -sy, 0.25 * b, look.top);
  circle(-0.04, sy, 0.25 * b, look.top);
  drawBackHair(
    look,
    (x, y, r) => circle(x, y, r, look.hair),
    (x, y, w, h) => ellipse(x, y, w, h, look.hair),
  );
  rect(0.12, -sy, 0.32, 0.2, darken(look.top));
  rect(0.12, sy, 0.32, 0.2, darken(look.top));
  circle(0.24, -sy, 0.14, look.skin, 1.5);
  circle(0.24, sy, 0.14, look.skin, 1.5);
  // head, and what is on it
  circle(0.06, 0, 0.28, look.hat === 'none' ? look.hair : look.hatColor);
  if (look.hat === 'none' && look.hairStyle === 'buzz') circle(0.06, 0, 0.2, look.skin, 0);
  ctx.globalAlpha = 0.18;
  ellipse(0.12, -0.06, 0.22, 0.16, 0xffffff, 0);
  ctx.globalAlpha = 1;
  if (look.hat === 'beanie') circle(-0.06, 0, 0.1, 0xe8e4dc, 1.5);
  if (look.hat === 'cap') rect(0.44, 0, 0.2, 0.44, look.hatColor);
  if (look.headphones) {
    rect(0.04, 0, 0.09, 0.72, 0x22242a, 0);
    circle(0.04, -0.32, 0.11, 0x33363e, 1.5);
    circle(0.04, 0.32, 0.11, 0x33363e, 1.5);
  }
  ctx.restore();
}

/**
 * HAIR THAT SHOWS BEYOND THE HEAD: long hair falls over the upper back, a
 * ponytail hangs down it, a bun sits at the back of the crown. Seen from
 * above all of it lies ON the back, so both the rig and the page draw it
 * over the shoulders and under the head; +x is the way the figure faces.
 */
export function drawBackHair(
  look: PlayerLook,
  circle: (x: number, y: number, r: number) => void,
  ellipse: (x: number, y: number, w: number, h: number) => void,
) {
  if (look.hairStyle === 'long') ellipse(-0.2, 0, 0.62, 0.66);
  else if (look.hairStyle === 'ponytail') ellipse(-0.36, 0, 0.5, 0.2);
  else if (look.hairStyle === 'bun' && look.hat !== 'beanie') circle(-0.22, 0, 0.15);
}

const darken = (c: number) => {
  const f = 0.82;
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
};
