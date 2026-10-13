/**
 * The horde's SHEETS: real frame animation, one spec per look. A look is an
 * enemy kind, or a kind plus a build (`runner:brute`); the rig asks for the
 * most specific one it can get and falls back to the classic static art when
 * nothing here has loaded, so a missing file is a look, never a crash.
 *
 * Each animation names its own PNG strip (xzany's packs ship one strip per
 * animation) or a range inside a shared sheet (Elthen's ship one sheet with
 * a row per animation, give `start` the first frame's index, counting
 * left-to-right, top-to-bottom). Frames are `frameW`×`frameH`; the rig scales
 * so the frame stands `targetH` world pixels tall.
 *
 * Fill this in as the files land in public/assets/fauna/. Nothing else needs
 * to change: DemoScene.preload loads every strip named here, and the rig
 * picks them up.
 */
export interface AnimSpec {
  /** texture key; unique per animation */
  key: string;
  /** relative to public/ */
  url: string;
  frameW: number;
  frameH: number;
  frames: number;
  /** first frame index inside the sheet; 0 for a strip */
  start?: number;
  fps: number;
}

export interface SheetSpec {
  /** how tall the frame stands in the world, in px (a vätte is ~27) */
  targetH: number;
  /** where the feet are, 0..1 down the frame; 0.5 centres it */
  anchorY?: number;
  /** the art faces left: flip the other way */
  facesLeft?: boolean;
  /** the speed (px/s) the run cycle depicts at its own fps; the rig scales the cycle to the real speed */
  runSpeed?: number;
  anims: {
    idle: AnimSpec;
    run: AnimSpec;
    attack?: AnimSpec;
    hurt?: AnimSpec;
    death?: AnimSpec;
    /** a stalker's burst, if the art has a charge */
    lunge?: AnimSpec;
  };
}

/** keyed by `kind` or `kind:variant` */
export const ENEMY_SHEETS: Record<string, SheetSpec> = {};
/** the most specific look on file for this enemy */
export function sheetFor(kind: string, variant: string): SheetSpec | undefined {
  return ENEMY_SHEETS[`${kind}:${variant}`] ?? ENEMY_SHEETS[kind];
}

export function allAnimSpecs(): AnimSpec[] {
  const out: AnimSpec[] = [];
  for (const sheet of Object.values(ENEMY_SHEETS))
    for (const a of Object.values(sheet.anims)) if (a) out.push(a);
  return out;
}
