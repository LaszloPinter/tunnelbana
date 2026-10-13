import type { LineColor } from '../core/network.ts';

/**
 * What colour a station is.
 *
 * The tunnelbana is often called the world's longest art gallery, and the
 * stations that stick in the memory stick because of their COLOUR before any
 * detail: Solna centrum is a red sky over a green spruce forest, Stadion is a
 * rainbow across a pale blue cavern, Rådhuset is raw ochre rock. That is what
 * this table carries.
 *
 * ---- what this deliberately is not ----
 *
 * §11 says station names and geography are facts and fair game. The paintings
 * are not: they are works by named artists, in copyright, and tracing them
 * would be exactly the kind of thing §11 exists to keep us out of. So nothing
 * here reproduces artwork. A palette is the dominant colour of a place, the
 * same class of fact as its name, applied to OUR generic surfaces: the rock
 * wash, the accent band, the light. A player who knows the network should feel
 * they have arrived somewhere recognisable without a single line of anyone
 * else's drawing being copied.
 *
 * ---- what is authored and what is derived ----
 *
 * Only stations whose colour is genuinely well known are named here. Guessing
 * at the other eighty would be worse than not trying: it would put confident
 * wrong colours on places the player knows better than we do. Everything else
 * derives a palette from its line and its depth, which is at least honest,
 * a bored cavern on the blue line, a tiled hall on the green.
 */

export interface Palette {
  /** tints the wall texture; kept light, since a tint only ever darkens */
  wash: number;
  /** the band along the wall, and anything that wants the station's own colour */
  accent: number;
  /**
   * What the wall is, where we know it and depth would get it wrong. Depth is
   * a good rule, the blue line is bored end to end and so is anything three
   * storeys down, but it needs plan data, and 15 stations have none. Stadion
   * and Tekniska högskolan are blasted caverns that came out as poured
   * concrete for want of a level tag.
   */
  facing?: 'rock' | 'tile' | 'concrete';
}

/**
 * The ones worth naming. Each is the colour the place reads as from the
 * platform, not a description of its artwork.
 */
const NAMED: Record<string, Palette> = {
  // red sky, spruce forest below, the most photographed cavern in the city
  'Solna centrum': { wash: 0xc05a4a, accent: 0x3f7a4a, facing: 'rock' },
  // white cavern under blue; the blue line's own colour, at its own station
  'T-Centralen': { wash: 0xa8c4e0, accent: 0x2f6fb0 },
  // pale sky-blue cavern, and the arch across it
  Stadion: { wash: 0x9fc4dc, accent: 0xd9584a, facing: 'rock' },
  // deep green, with the fragments of the old city it was dug through
  Kungsträdgården: { wash: 0x6f8a5a, accent: 0xb07038, facing: 'rock' },
  // bare ochre rock, ribbed like a cave
  Rådhuset: { wash: 0xc08a52, accent: 0x8a4f2a, facing: 'rock' },
  // white and blue, geometry on the walls
  'Tekniska högskolan': { wash: 0xc8d4e4, accent: 0x2f6fb0, facing: 'rock' },
  // white, drawn on in blue
  Universitetet: { wash: 0xd0d8e4, accent: 0x3a6fa8, facing: 'rock' },
  // The 8-bit tiling, in its primaries. Its platforms stand in an open
  // cutting, which OSM agrees with, so the game gives it sky and no wall,
  // and this entry only reaches its accent until retaining walls are modelled.
  Thorildsplan: { wash: 0x9fb4c8, accent: 0x4aa050, facing: 'tile' },
  // white walls given over to children's drawing
  Hallonbergen: { wash: 0xd4d4d8, accent: 0x4a4a52, facing: 'rock' },
};

const BY_LINE: Record<LineColor, Palette> = {
  green: { wash: 0xa8b8c8, accent: 0x4a9a58 },
  red: { wash: 0xb8a8a8, accent: 0xc05050 },
  blue: { wash: 0x9fb0c8, accent: 0x3f7ac0 },
};

/**
 * A station's palette. Named where we actually know it; otherwise its line's,
 * nudged by a per-station number so two neighbouring stops on the same line do
 * not come out identical.
 */
export const stationPalette = (name: string, line: LineColor, vary: number): Palette => {
  const named = NAMED[name];
  if (named) return named;
  const base = BY_LINE[line];
  // A deterministic nudge per station: enough that two stops on the same line
  // are not the same room, not so much that the line stops reading as one
  // line. The first pass rotated by up to 0.15 and then the tile wall halved
  // that again, which left Hotorget and Odenplan a hex apart, invisible.
  const roll = (c: number, amount: number, lift: number) => {
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    const ch = (v: number, toward: number) =>
      Math.max(0, Math.min(255, Math.round((v + (toward - v) * amount) * lift)));
    return (ch(r, b) << 16) | (ch(g, r) << 8) | ch(b, g);
  };
  const amount = 0.1 + vary * 0.4;
  // and a little lighter or darker, so even a station whose hue lands close to
  // its neighbour's still reads as its own place
  const lift = 0.88 + vary * 0.24;
  return { wash: roll(base.wash, amount, lift), accent: roll(base.accent, amount, 1) };
};

/** is this station's colour something we actually know, or derived? */
export const paletteIsNamed = (name: string): boolean => name in NAMED;
