import type Phaser from 'phaser';
import type { Enemy } from '../combat/types.ts';
import { CHARGES_TO_BLOW } from '../combat/charge.ts';

/**
 * THE CHARGES ON A BODY (combat/charge.ts): one amber ring per charge, close
 * round it, pulsing faster the nearer it is to going off, the fuse you can
 * read across a pack. One Graphics for all of them, redrawn per frame; no
 * random here.
 */
export function drawCharges(g: Phaser.GameObjects.Graphics, enemies: readonly Enemy[], now: number) {
  g.clear();
  for (const e of enemies) {
    if (e.hp <= 0 || e.charge <= 0) continue;
    const n = Math.min(e.charge, CHARGES_TO_BLOW - 1);
    const pulse = 0.5 + 0.5 * Math.sin(now / (n >= 2 ? 70 : 160));
    for (let i = 0; i < n; i++) {
      const r = e.r * 1.15 + i * 4;
      const col = i === 0 ? 0xffb61e : 0xffe08a;
      g.lineStyle(2 + pulse, col, 0.45 + 0.4 * pulse);
      g.strokeCircle(e.x, e.y, r);
    }
    g.fillStyle(0xffb61e, 0.08 + 0.12 * pulse * n);
    g.fillCircle(e.x, e.y, e.r * 1.15);
  }
}
