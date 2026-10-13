import Phaser from 'phaser';
import * as C from '../config.ts';
import * as DEPTH from './depth.ts';
import { asLeg, asStation } from '../sim/place.ts';
import { fromLeg, fromPlatform } from '../world/floor.ts';
import type { Run } from '../sim/run.ts';

/**
 * WHAT IS ACTUALLY THERE, the map with its answers drawn on top of it.
 *
 * Every seam argument in this rebuild has been the same shape: a black band
 * where a station meets a tunnel, and no way to tell from a screenshot
 * whether the FLOOR is missing, the PICTURE of it is missing, or the two
 * simply disagree about where the join is. Measuring in a probe answers it
 * for a station nobody is standing in; this answers it for the one on screen.
 *
 * J turns it on:
 *   every baked patch outlined, green deck, yellow bed, magenta bore. That
 *     is the ground a body actually walks on, straight from the collision
 *     mesh, so a gap here is a gap in the WORLD.
 *   a thick RED line across each station's two ends.
 *   a thick BLUE line across each bore's two mouths.
 * Red and blue should land on top of each other. Where they do not is the
 * disagreement, and how far apart they are is how big it is.
 */
export class MapDebug {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  on = false;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.OVERHEAD).setVisible(false);
    // ...and the same answers as NUMBERS, because a colour that is not on
    // screen tells you nothing about why it is not
    // TOP RIGHT, on its own ground. At the top left it sat behind the
    // journey box and there was nothing to read.
    this.text = scene.add
      .text(C.GAME_WIDTH - 10, 40, '', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#b0ffd0',
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 6 },
        align: 'right',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.OVERHEAD + 0.1)
      .setVisible(false);
    // ...and ONLY by the fixed camera. Scroll factor holds a thing still
    // while the view slides; it does nothing about the view TURNING, and
    // this one turns with the track, so the readout rolled off the screen.
    scene.cameras.main.ignore(this.text);
  }

  /** what the map is made of, and who is in it */
  private report(run: Run) {
    const by = new Map<string, number>();
    for (const p of run.map.patches) by.set(p.kind, (by.get(p.kind) ?? 0) + 1);
    const kinds = [...by].map(([k, n]) => `${k} ${n}`).join('  ');
    const live = [...run.live].map((id) => id.replace(/^(st|leg):/, '')).join(', ');
    const on = run.map.at(run.me.x, run.me.y);
    this.text.setText(
      [
        `patches ${run.map.patches.length}: ${kinds}`,
        `live ${run.live.size}: ${live}`,
        `here ${run.here.id} | standing on ${on ? `${on.kind} of ${on.place.id}` : 'NOTHING'}`,
      ].join('\n'),
    );
  }

  toggle(): string {
    this.on = !this.on;
    this.g.setVisible(this.on);
    this.text.setVisible(this.on);
    return this.on
      ? 'Map debug ON: green deck, yellow bed, magenta bore; red station end, blue bore mouth'
      : 'Map debug off';
  }

  draw(run: Run) {
    if (!this.on) return;
    this.report(run);
    const g = this.g;
    g.clear();
    // the collision mesh itself
    for (const p of run.map.patches) {
      const c =
        p.kind === 'platform' ? 0x40ff80 : p.kind === 'bed' ? 0xffd040 : p.kind === 'bore' ? 0xff40ff : 0;
      if (!c) continue;
      g.lineStyle(1, c, 0.5);
      g.beginPath();
      g.moveTo(p.x[0], p.y[0]);
      for (let i = 1; i < 4; i++) g.lineTo(p.x[i], p.y[i]);
      g.closePath();
      g.strokePath();
    }
    for (const id of run.live) {
      const pl = run.places.get(id);
      const st = asStation(pl);
      if (st) {
        // RED: where this station says it stops, across its whole width
        g.lineStyle(6, 0xff2020, 0.95);
        for (const x of [st.platformX0, st.platformX1]) {
          const a = fromPlatform(st, x, st.worldTopY);
          const b = fromPlatform(st, x, st.worldBottomY);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.strokePath();
        }
        continue;
      }
      const leg = asLeg(pl);
      if (!leg) continue;
      // BLUE: where this bore says it starts, across its own band
      g.lineStyle(6, 0x3080ff, 0.95);
      for (const s of [leg.cor.s0, leg.cor.s1]) {
        const band = leg.arcBand(s);
        const a = fromLeg(leg, s, band.top);
        const b = fromLeg(leg, s, band.bottom);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
      }
    }
  }
}
