import Phaser from 'phaser';
import * as C from '../config.ts';
import { mulberry32 } from '../core/lineData.ts';
import { stationGeo } from '../data/stationGeometry.ts';
import { addLabel, uiLabelKey } from './labelArt.ts';
import type { PlatformPath } from '../core/platformPath.ts';
import { stationPalette } from '../data/stationPalette.ts';
import { dressFurniture, type KioskGfx } from './stationFurniture.ts';
import type { StationPlan } from '../sim/stationPlan.ts';
export type { Box } from '../sim/stationPlan.ts';
import { SLAB, Sweeper, TILE } from './stationSweep.ts';
import { dressCover, pastMouth } from './stationCover.ts';
import { dressWalls } from './stationWalls.ts';

/** everything the station builder needs from the scene, and writes back into */
export interface StationCtx {
  scene: Phaser.Scene;
  worldW: number;
  bedTop: number;
  platTop: number;
  platBottom: number;
  bed2Bottom: number;
  rails: { edgeY: number; inward: 1 | -1; slot: number; bandTop: number; bandBottom: number }[];
  worldBoards: { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text }[];
  platforms: { top: number; bottom: number; color: 'green' | 'red' | 'blue' }[];
  passages: { x0: number; x1: number }[];
  /** the station's centreline: everything long is swept along it */
  path: PlatformPath;
  /** the storeys this station has above and below the one being built: -1 is
   * one flight down. Each becomes a shaft on every island */
  shaftsTo: { delta: -1 | 1; label: string }[];
  /**
   * IS THERE A LEG OFF THIS END, bored or open? Everything this file lays
   * runs out past the platform by a little at a terminus, the bed by four
   * metres, the accent band by six, the wall and the backdrop by eight, and
   * not at all past a mouth: from there on the LEG owns the floor, the walls
   * and the backdrop (stationCover.ts pastMouth, the one rule for all four).
   * Two pictures stopping at different lines left a staircase of edges
   * across the tunnel (from play 2026-09-12), and one forgotten margin left
   * a black band across it (2026-09-13).
   */
  boreL: boolean;
  boreR: boolean;
  /** which storey this is, as OSM numbers it. Deep means blasted, and blasted
   * means a cavern wall rather than a tiled one */
  storey: number;
  /** WHERE everything stands, decided by the simulation (src/sim/stationPlan.ts);
   * this builder only dresses it */
  plan: StationPlan;
}

export interface StationBuild {
  decor: Phaser.GameObjects.GameObject[];
  kioskGfx: KioskGfx[];
}

/**
 * Draws one station: real OSM platform length, indoor/outdoor dressing, ads in
 * their real formats, escalator exits, benches, vending machines, and the
 * floor-projected departure boards. Seeded by station index, so a station
 * always looks like itself.
 */
export function buildStation(ctx: StationCtx, station: string): StationBuild {
  let seed = 13;
  for (let i = 0; i < station.length; i++) seed = (seed * 31 + station.charCodeAt(i)) | 0;
  const rng = mulberry32(seed);
  const midX = ctx.worldW / 2;

  // real platform length from OSM (Skanstull ~180m, Blåsut ~104m, ...)
  const geo = stationGeo(station);
  const outdoor = geo.outdoor;
  const lenPx = C.M(geo.lengthM);
  const platformX0 = midX - lenPx / 2;
  const platformX1 = midX + lenPx / 2;

  // The station's own colour (src/data/stationPalette.ts): named where the
  // place is genuinely known for it, derived from the line elsewhere. A
  // palette, never artwork: §11.
  const palette = stationPalette(station, ctx.platforms[0]?.color ?? 'green', rng());
  const sw = new Sweeper(ctx.scene, ctx.path);
  const D = sw.decor;

  // Above ground the whole place is lit: the ballast, the platform deck and
  // the ground beyond all lift. Below ground they stay cave-dark.
  const BED = outdoor ? 0x30333c : 0x15151b;
  const SLEEPER = outdoor ? 0x6b6f7a : 0x4a4a55;
  const DECK = outdoor ? 0x585c68 : 0x3a3a44;
  const EDGE = outdoor ? 0xb0ad8c : 0x8a8a70;

  // every rail's bed: the platform's length and a short apron past each
  // end. From the mouth on, the LEG owns the floor and draws its own bore,
  // tracks and walls (src/render/tunnelArt.ts) at the corridor's cross-section
  for (const rail of ctx.rails) {
    const bedX0 = platformX0 - pastMouth(ctx, -1, C.M(4));
    const bedX1 = platformX1 + pastMouth(ctx, 1, C.M(4));
    const mid = (rail.bandTop + rail.bandBottom) / 2;
    sw.sweep(bedX0, bedX1, rail.bandTop, rail.bandBottom, BED, 0);
    sw.sweep(bedX0, bedX1, mid - 15, mid - 13, SLEEPER, 0.5);
    sw.sweep(bedX0, bedX1, mid + 11, mid + 13, SLEEPER, 0.5);
  }
  // The deck: a surface, not a flat fill. Open-air platforms are cast
  // slabs, the shallow halls are tiled, and the blue line's bored caverns
  // are sprayed rock with no grid at all.
  for (const pf of ctx.platforms) {
    const paving = outdoor ? SLAB : pf.color === 'blue' ? undefined : TILE;
    sw.sweep(platformX0, platformX1, pf.top, pf.bottom, DECK, 0, 1, paving);
    sw.sweep(platformX0, platformX1, pf.top, pf.top + 3, EDGE, 1);
    sw.sweep(platformX0, platformX1, pf.bottom - 3, pf.bottom, EDGE, 1);
  }

  // transfer passages: bridged crossings between islands
  for (const pg of ctx.passages) {
    D.push(
      ctx.scene.add
        .rectangle(
          (pg.x0 + pg.x1) / 2,
          (ctx.bedTop + ctx.bed2Bottom) / 2,
          pg.x1 - pg.x0,
          ctx.bed2Bottom - ctx.bedTop,
          0x4a4a54,
        )
        .setDepth(1.1)
        .setStrokeStyle(2, 0x8a8a70, 0.8),
      addLabel(ctx.scene, (pg.x0 + pg.x1) / 2, ctx.bedTop + C.M(1.2), uiLabelKey('BYTE')).setDepth(1.2),
    );
  }
  if (!outdoor) {
    const aX0 = platformX0 - pastMouth(ctx, -1, C.M(6));
    const aX1 = platformX1 + pastMouth(ctx, 1, C.M(6));
    const accentMid = (aX0 + aX1) / 2;
    const accentW = aX1 - aX0;
    // accent bands along the cave walls, each stop's own color
    D.push(
      ctx.scene.add
        .rectangle(accentMid, ctx.bedTop - C.M(5.6), accentW, C.M(0.9), palette.accent)
        .setDepth(-0.4)
        .setAlpha(0.75),
      ctx.scene.add
        .rectangle(accentMid, ctx.bed2Bottom + C.M(5.6), accentW, C.M(0.9), palette.accent)
        .setDepth(-0.4)
        .setAlpha(0.75),
    );
  }
  dressCover(ctx, D, platformX0, platformX1, outdoor, rng);
  if (!outdoor) dressWalls(ctx, D, platformX0, platformX1, palette, rng);

  // The board graphics are pooled by SLOT, not by rail index, the two only
  // agree until a station lays out with the ridden track pinned, after which
  // indexing by rail put each board on the wrong track's edge.
  //
  // Placed BEFORE the furniture, which keeps clear of them: it used to read
  // the boards' positions off the graphics, which at that point were still
  // the LAST station's, so where a machine or the kiosk stood depended on
  // where you had come from, and the same seed built a different station on
  // a fresh page than after a run. The replay check found it.
  for (let i = 0; i < ctx.rails.length; i++) {
    const rail = ctx.rails[i];
    const bx = ctx.plan.boardXs[i] ?? midX;
    const by = rail.edgeY + rail.inward * C.M(1.7) + ctx.path.offsetAt(bx);
    ctx.worldBoards[rail.slot].bg.setPosition(bx, by);
    ctx.worldBoards[rail.slot].text.setPosition(bx, by);
  }

  // what stands on the platform: the plan decided where (simulation state);
  // stationFurniture.ts only paints it
  const { decor: furnishings, kioskGfx } = dressFurniture(ctx, ctx.plan);
  D.push(...furnishings);

  sw.flush();
  return { decor: D, kioskGfx };
}
