import Phaser from 'phaser';
import * as C from '../config.ts';
import type { Enemy } from '../combat/types.ts';
import { dacos, dcos, dsin } from '../sim/det.ts';

/**
 * The ward's picture, drawn for the horde now (combat/shield.ts): an arc of
 * hex cells held toward whoever the elite is after, purple and thinning as it
 * is beaten down. One Graphics for all of them, redrawn per frame; nothing
 * here touches the run's random stream.
 */
export function drawWards(sg: Phaser.GameObjects.Graphics, enemies: readonly Enemy[], upright: number) {
  sg.clear();
  const half = dacos(C.SHIELD_DOT);
  for (const e of enemies) {
    const w = e.ward;
    if (!w || w.hp <= 0 || e.hp <= 0) continue;
    const frac = Phaser.Math.Clamp(w.hp / w.max, 0, 1);
    const col = frac > 0.35 ? 0xb07cff : 0xff7a5a;
    const R = e.r * 2.2;
    const inner = R * 0.6;
    const a0 = w.angle + upright;
    const hs = Math.max(5, R * 0.28);
    const stepX = hs * Math.sqrt(3);
    const stepY = hs * 1.5;
    sg.lineStyle(1, col, 0.25 + 0.45 * frac);
    for (let row = -Math.ceil(R / stepY) - 1; row <= Math.ceil(R / stepY) + 1; row++) {
      for (let cIdx = -Math.ceil(R / stepX) - 1; cIdx <= Math.ceil(R / stepX) + 1; cIdx++) {
        const ox = cIdx * stepX + (row & 1 ? stepX / 2 : 0);
        const oy = row * stepY;
        const d = Math.hypot(ox, oy);
        if (d < inner || d > R) continue;
        let da = Math.atan2(oy, ox) - a0;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > half) continue;
        const hx = e.x + ox;
        const hy = e.y + oy;
        sg.beginPath();
        for (let k = 0; k <= 6; k++) {
          const ha = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const vx = hx + dcos(ha) * hs * 0.9;
          const vy = hy + dsin(ha) * hs * 0.9;
          if (k === 0) sg.moveTo(vx, vy);
          else sg.lineTo(vx, vy);
        }
        sg.strokePath();
      }
    }
    sg.fillStyle(col, 0.05 + 0.08 * frac);
    sg.beginPath();
    sg.arc(e.x, e.y, R, a0 - half, a0 + half);
    sg.arc(e.x, e.y, inner, a0 + half, a0 - half, true);
    sg.closePath();
    sg.fillPath();
    sg.lineStyle(2, col, 0.5 + 0.4 * frac);
    sg.beginPath();
    sg.arc(e.x, e.y, R, a0 - half, a0 + half);
    sg.strokePath();
  }
}
