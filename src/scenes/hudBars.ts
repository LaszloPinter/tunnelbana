import Phaser from 'phaser';
import * as C from '../config.ts';
import { manaMax, maxHp } from '../sim/player.ts';
import type { Run } from '../sim/run.ts';

/** the HUD's bars: the two signage-style vitals, and the king's health */

/** two signage-style bars, glanceable at the bottom left */
export function drawVitals(
  g: Phaser.GameObjects.Graphics,
  hpLabel: Phaser.GameObjects.Text,
  manaLabel: Phaser.GameObjects.Text,
  hurtVignette: Phaser.GameObjects.Rectangle,
  sim: Run,
  now: number,
) {
  const me = sim.me;
  const mMax = manaMax(sim.party, me);
  const hpFrac = Phaser.Math.Clamp(me.health / maxHp(me), 0, 1);
  const mpFrac = Phaser.Math.Clamp(me.mana / mMax, 0, 1);
  const bx = 22;
  const bw = 240;
  const bh = 19;
  g.clear();
  const bar = (y: number, frac: number, fill: number, dim: number) => {
    g.fillStyle(0x0e1116, 0.9);
    g.fillRoundedRect(bx - 4, y - bh / 2 - 4, bw + 8, bh + 8, 6);
    g.fillStyle(dim, 1);
    g.fillRoundedRect(bx, y - bh / 2, bw, bh, 4);
    if (frac > 0.001) {
      g.fillStyle(fill, 1);
      g.fillRoundedRect(bx, y - bh / 2, Math.max(6, bw * frac), bh, 4);
    }
    g.lineStyle(2, 0x2a3038, 1);
    g.strokeRoundedRect(bx, y - bh / 2, bw, bh, 4);
    // tick marks every 25%
    g.lineStyle(1, 0x0e1116, 0.5);
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo(bx + (bw * k) / 4, y - bh / 2 + 2);
      g.lineTo(bx + (bw * k) / 4, y + bh / 2 - 2);
      g.strokePath();
    }
  };
  const hpY = C.GAME_HEIGHT - 62;
  const mpY = C.GAME_HEIGHT - 36;
  const lowHp = hpFrac < 0.3;
  bar(hpY, hpFrac, lowHp && Math.sin(now / 140) > 0 ? 0xff8a6a : 0xd6453c, 0x3a1e1e);
  bar(mpY, mpFrac, 0x7a4fd0, 0x241e3a);
  hpLabel
    .setText(`HP ${Math.max(0, Math.round(me.health))}${maxHp(me) !== 100 ? `/${maxHp(me)}` : ''}`)
    .setY(hpY);
  manaLabel.setText(`MANA ${me.mana}/${mMax}`).setY(mpY);
  hurtVignette.setAlpha(lowHp ? 0.06 + Math.sin(now / 140) * 0.05 : 0);
}

/** the king's bar: while a boss stands, his health hangs top-centre */
export function drawBossBar(
  bossBar: Phaser.GameObjects.Graphics,
  bossName: Phaser.GameObjects.Text,
  sim: Run,
) {
  const boss = sim.here.enemies.find((e) => e.type === 'boss' && e.hp > 0);
  bossBar.clear();
  bossName.setVisible(!!boss);
  if (!boss) return;
  const bw = 420;
  const bx = C.GAME_WIDTH / 2 - bw / 2;
  const by = 84;
  const frac = Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1);
  bossBar.fillStyle(0x0e1116, 0.9);
  bossBar.fillRoundedRect(bx - 4, by - 4, bw + 8, 22, 6);
  bossBar.fillStyle(0x3a3320, 1);
  bossBar.fillRoundedRect(bx, by, bw, 14, 4);
  if (frac > 0.001) {
    bossBar.fillStyle(0xd8c06a, 1);
    bossBar.fillRoundedRect(bx, by, Math.max(6, bw * frac), 14, 4);
  }
}

/** P: the keys, over the held world */
export function pausePanel(s: Phaser.Scene): Phaser.GameObjects.Text {
  const mono = (size: number, color: string, extra: Record<string, unknown> = {}) => ({
    fontFamily: 'monospace',
    fontSize: `${size}px`,
    color,
    ...extra,
  });
  return s.add
    .text(
      C.GAME_WIDTH / 2,
      C.GAME_HEIGHT / 2,
      [
        'PAUSED',
        '',
        'WASD           move',
        'SPACE          dash (dodges everything)',
        'MOUSE          aim & cast',
        'RMB / Q        STÖT: a shockwave (12 mana) that throws back, stuns, breaks wards',
        '2 / 3          bolt · torrent',
        'E              buy at a machine · leave at an EXIT',
        'TAB            your travelcard and perks',
        'P              pause      R      restart run',
        'ESC            back to the landing. The run is saved',
        '',
        'Read the boards. Take the train that says your number.',
        '',
        'P to resume   ·   ESC for the landing',
      ].join('\n'),
      mono(16, '#e8e8f0', { align: 'left', backgroundColor: '#0e1116f2', padding: { x: 26, y: 20 } }),
    )
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(210)
    .setVisible(false);
}
