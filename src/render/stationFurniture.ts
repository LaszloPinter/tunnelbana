import Phaser from 'phaser';
import { COLUMN_IN, COLUMN_OUT, COLUMN_R } from './wallArt.ts';
import * as C from '../config.ts';
import { addLabel, uiLabelKey } from './labelArt.ts';
import type { StationCtx } from './stationBuilder.ts';
import type { StationPlan } from '../sim/stationPlan.ts';

/**
 * The furniture's PICTURE. Where everything stands was decided by
 * `src/sim/stationPlan.ts`, pure data, no renderer in the room, because the
 * simulation collides with benches and columns and spawns at exits, so their
 * positions are simulation state. This file only dresses that plan: it rolls
 * nothing, it claims nothing, it just draws each planned piece where the plan
 * put it, bent through the platform's path like everything else.
 */

export interface KioskGfx {
  body: Phaser.GameObjects.Rectangle;
  pane: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Rectangle;
  lamp: Phaser.GameObjects.Arc;
}

export interface FurnitureDress {
  decor: Phaser.GameObjects.GameObject[];
  kioskGfx: KioskGfx[];
}

export function dressFurniture(ctx: StationCtx, plan: StationPlan): FurnitureDress {
  const D: Phaser.GameObjects.GameObject[] = [];
  const kioskGfx: KioskGfx[] = [];
  const { outdoor } = plan;
  // ONE FIXTURE, ONE PIECE. A machine is a body, a lit pane, a slot and a
  // word; shown from the room's other end it turns half round ABOUT ITS OWN
  // MIDDLE, so it stands where it stands and still reads (placeView.ts
  // turnWords, roomPose.ts). As loose rectangles each turned about itself,
  // the pane came out at the bottom and the word under the machine (from
  // play 2026-09-24: "they are upside down now").
  const fixture = (cx: number, cy: number, depth: number, parts: Phaser.GameObjects.GameObject[]) => {
    const c = ctx.scene.add.container(cx, cy, parts).setDepth(depth).setData('upright', true);
    D.push(c);
    return c;
  };

  // ---- the shafts: the well you look down into ----
  for (const sh of plan.shafts) {
    const o = ctx.path.offsetAt(sh.x);
    const y = sh.y + o;
    const parts: Phaser.GameObjects.GameObject[] = [
      ctx.scene.add.rectangle(0, 0, sh.w, sh.h, 0x0b0d12).setStrokeStyle(2, 0x6a7180),
    ];
    // treads, receding: the flight is going away from you either way
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      parts.push(
        ctx.scene.add
          .rectangle(-sh.w / 2 + C.M(0.35) + t * (sh.w - C.M(0.7)), 0, C.M(0.32), sh.h - C.M(0.7), 0x2b313c)
          .setAlpha(0.35 + (sh.delta < 0 ? t : 1 - t) * 0.55),
      );
    }
    parts.push(addLabel(ctx.scene, 0, -sh.h / 2 - C.M(0.7), uiLabelKey(sh.label)));
    fixture(sh.x, y, 1.9, parts);
  }

  // ---- the exits: a foot on the platform, the flight overhead ----
  for (const ex of plan.exits) {
    const { x: cx, midY, dirOut, withLift } = ex;
    const lanes = 3;
    const stepW = C.M(1.15);
    const bankW = lanes * stepW + C.M(0.4);
    const footL = C.M(3);
    const flightL = C.M(11);
    const o = ctx.path.offsetAt(cx);

    D.push(
      ctx.scene.add
        .rectangle(cx, midY + o, footL, bankW, 0x1d2128)
        .setDepth(2)
        .setStrokeStyle(2, 0x11131a),
    );
    for (let lane = 0; lane < lanes; lane++) {
      const ly = midY + o - bankW / 2 + stepW * (lane + 0.5) + C.M(0.2);
      D.push(ctx.scene.add.rectangle(cx, ly, footL - C.M(0.4), stepW - C.M(0.18), 0x2c3138).setDepth(2.05));
    }

    // the flight, overhead: it climbs away and the platform light gives out
    const steps = 7;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const sx = cx + dirOut * (footL / 2 + (t + 0.5 / steps) * flightL);
      // never past the platform's end: out there the flight hung in the
      // tunnel mouth as a row of fading boxes that read as cars
      if (sx < plan.platformX0 || sx > plan.platformX1) continue;
      D.push(
        ctx.scene.add
          .rectangle(
            sx,
            midY + ctx.path.offsetAt(sx),
            flightL / steps - C.M(0.1),
            bankW * (1 - t * 0.28),
            i % 2 ? 0x454c56 : 0x545c67,
          )
          .setDepth(7.5)
          .setAlpha(0.5 * (1 - t) ** 1.2),
      );
    }

    // the green sign at the foot, and the word over it
    D.push(
      ctx.scene.add
        .rectangle(cx, midY + o - bankW / 2 - C.M(0.5), C.M(1.5), C.M(0.44), 0x1e4630)
        .setDepth(2.2)
        .setStrokeStyle(1.5, 0x14151c),
      ctx.scene.add
        .rectangle(cx, midY + o - bankW / 2 - C.M(0.5), C.M(1.5), C.M(0.44), 0x54c884)
        .setDepth(2.15)
        .setAlpha(0.32)
        .setBlendMode(Phaser.BlendModes.ADD),
      addLabel(ctx.scene, cx, midY + o - bankW / 2 - C.M(1.35), uiLabelKey('EXIT')).setDepth(3),
    );

    if (withLift) {
      const lx = cx - dirOut * (footL / 2 + C.M(2));
      const lo = ctx.path.offsetAt(lx);
      D.push(
        ctx.scene.add
          .rectangle(lx, midY + lo, C.M(2.4), C.M(2.4), 0x232830)
          .setDepth(2)
          .setStrokeStyle(2, 0x11131a),
        ctx.scene.add.rectangle(lx, midY + lo, C.M(1.1), C.M(1.1), 0x2e343d).setDepth(2.08),
        ctx.scene.add.rectangle(lx, midY + lo + C.M(1.05), C.M(1.5), C.M(0.28), 0x59626d).setDepth(2.1),
      );
    }
  }

  // ---- the machines ----
  const drawMachine = (mx: number, midY: number, tint: number, label: string) => {
    const my = midY + ctx.path.offsetAt(mx);
    const body = Phaser.Display.Color.IntegerToColor(tint);
    fixture(mx, my, 2, [
      ctx.scene.add
        .rectangle(0, 0, C.M(1.25), C.M(1.55), body.clone().darken(28).color)
        .setStrokeStyle(2, 0x14151c),
      ctx.scene.add
        .rectangle(0, -C.M(0.28), C.M(0.95), C.M(0.62), body.clone().brighten(28).color)
        .setStrokeStyle(1.5, 0x14151c),
      ctx.scene.add
        .rectangle(0, -C.M(0.28), C.M(0.95), C.M(0.62), body.clone().brighten(28).color)
        .setAlpha(0.35)
        .setBlendMode(Phaser.BlendModes.ADD),
      ctx.scene.add.rectangle(0, C.M(0.5), C.M(0.7), C.M(0.24), 0x101216),
      addLabel(ctx.scene, 0, -C.M(1.1), uiLabelKey(label)),
    ]);
  };
  for (const m of plan.manaMachines) drawMachine(m.x, m.y, 0x7a4fd0, 'MANA');
  for (const m of plan.healthMachines) drawMachine(m.x, m.y, 0x3dbb6e, 'HEALTH');

  // ---- the kiosks: shuttered until the station is cleared (§16) ----
  for (const k of plan.kiosks) {
    const w = C.M(2.2);
    const ky = k.y + ctx.path.offsetAt(k.x);
    const body = ctx.scene.add.rectangle(0, 0, w, C.M(1.7), 0x1c2230).setStrokeStyle(2, 0x14151c);
    const pane = ctx.scene.add
      .rectangle(0, -C.M(0.25), w - C.M(0.5), C.M(0.8), 0x2a3344)
      .setStrokeStyle(1.5, 0x14151c);
    const glow = ctx.scene.add
      .rectangle(0, -C.M(0.25), w - C.M(0.5), C.M(0.8), 0xffd23f)
      .setAlpha(0)
      .setBlendMode(Phaser.BlendModes.ADD);
    const lamp = ctx.scene.add.circle(w / 2 - C.M(0.25), -C.M(0.65), 3, 0xd6453c);
    fixture(k.x, ky, 2, [
      body,
      pane,
      ctx.scene.add.rectangle(0, C.M(0.55), w - C.M(0.3), C.M(0.22), 0x101216),
      glow,
      lamp,
      addLabel(ctx.scene, 0, -C.M(1.2), uiLabelKey('KIOSK')),
    ]);
    kioskGfx.push({ body, pane, glow, lamp });
  }

  // ---- the benches, drawn from their collision boxes ----
  for (const b of plan.benches) {
    const bx = (b.x0 + b.x1) / 2;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const bo = ctx.path.offsetAt(bx);
    D.push(
      ctx.scene.add
        .rectangle(bx, b.y0 + bh / 2 + bo, bw, bh, 0x2a2622)
        .setDepth(2)
        .setStrokeStyle(1.5, 0x14151c),
    );
    for (let k = 0; k < 3; k++) {
      D.push(
        ctx.scene.add
          .rectangle(bx, b.y0 + bh * (0.22 + k * 0.28) + bo, bw - 5, bh * 0.2, 0x8a6538)
          .setDepth(2.1),
      );
    }
  }

  // ---- the columns: one baked octagon (wallArt.ts), one image apiece ----
  for (const p of plan.pillars) {
    const cx = (p.x0 + p.x1) / 2;
    const cy = (p.y0 + p.y1) / 2 + ctx.path.offsetAt(cx);
    const r = (p.x1 - p.x0) / 2;
    D.push(
      ctx.scene.add
        .image(cx, cy, outdoor ? COLUMN_OUT : COLUMN_IN)
        .setScale(r / COLUMN_R)
        .setDepth(2.6),
    );
  }

  return { decor: D, kioskGfx };
}
