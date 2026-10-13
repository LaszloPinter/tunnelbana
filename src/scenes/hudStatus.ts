import Phaser from 'phaser';
import * as C from '../config.ts';
import { shortName } from '../core/network.ts';
import { LANE_INFO } from '../core/lanes.ts';
import type { Run } from '../sim/run.ts';
import { asLeg, asStation } from '../sim/place.ts';

/**
 * THE STATUS STRIP along the bottom of the screen: the vitals and the card
 * sit at its left end (hudBars.ts, cardsHud.ts), and the rest is CHIPS, a
 * small spaced label over a large value, for what you cast, STÖT, your
 * kronor, your level, your lanes, the station and your kills.
 *
 * It replaced one line of 13 px grey monospace that read "[BOLT] [STÖT ready
 * · 12 mana] 0 kr LVL 1 (0/6) wave 1/3 · 15 left kills 0 † 1", which the
 * alpha UX pass found nobody could read at a glance (2026-09-30).
 */
export const UI_FONT = "'Barlow', 'Helvetica Neue', Arial, sans-serif";
export const DATA_FONT = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

/** the strip's top edge, and where the card's caption sits */
export const STRIP_H = 96;
const CHIPS_X = 410;
const GAP = 30;
/** the strip's right edge: the chips are packed tighter rather than cross it */
const RIGHT = C.GAME_WIDTH - 16;

interface Chip {
  label: Phaser.GameObjects.Text;
  value: Phaser.GameObjects.Text;
  /** a small bar under the value (the level's xp), drawn on the strip's graphics */
  bar?: number;
}

type ChipId = 'cast' | 'stot' | 'kr' | 'level' | 'boost' | 'lanes' | 'station' | 'kills';

export class HudStatus {
  private readonly strip: Phaser.GameObjects.Graphics;
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly cardCaption: Phaser.GameObjects.Text;
  private readonly chips = new Map<ChipId, Chip>();
  private readonly order: ChipId[] = ['cast', 'stot', 'kr', 'level', 'boost', 'lanes', 'station', 'kills'];
  private layoutKey = '';
  /** ⏩ while a ride is fast-forwarded (scenes/tickLoop.ts rideWarp) */
  private readonly warp: Phaser.GameObjects.Text;

  constructor(s: Phaser.Scene) {
    this.strip = s.add.graphics().setScrollFactor(0).setDepth(98.5);
    const top = C.GAME_HEIGHT - STRIP_H;
    this.strip.fillGradientStyle(0x070a11, 0x070a11, 0x070a11, 0x070a11, 0, 0, 0.96, 0.96);
    this.strip.fillRect(0, top - 18, C.GAME_WIDTH, 18);
    this.strip.fillStyle(0x070a11, 1);
    this.strip.fillRect(0, top, C.GAME_WIDTH, STRIP_H);
    this.bars = s.add.graphics().setScrollFactor(0).setDepth(100);
    this.warp = s.add
      .text(C.GAME_WIDTH / 2, 44, '⏩  4×', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#8cc4f0',
        backgroundColor: '#070a11b0',
        padding: { x: 10, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(102)
      .setVisible(false);
    this.cardCaption = s.add
      .text(362, C.GAME_HEIGHT - 10, 'CARD · TAB', {
        fontFamily: DATA_FONT,
        fontSize: '9px',
        color: '#79849a',
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(102);
    for (const id of this.order) {
      const label = s.add
        .text(0, C.GAME_HEIGHT - 70, '', {
          fontFamily: DATA_FONT,
          fontSize: '10px',
          color: '#79849a',
        })
        .setScrollFactor(0)
        .setDepth(101);
      label.setLetterSpacing?.(1.5);
      const value = s.add
        .text(0, C.GAME_HEIGHT - 54, '', {
          fontFamily: UI_FONT,
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#edf1f7',
        })
        .setScrollFactor(0)
        .setDepth(101);
      // LANES STACK, two to a line and smaller: four of them in one line
      // pushed the station and the kills off the screen (from play 2026-09-30)
      if (id === 'lanes' || id === 'boost')
        value
          .setFontSize(14)
          .setLineSpacing(-2)
          .setY(C.GAME_HEIGHT - 55);
      this.chips.set(id, { label, value });
    }
  }

  /** every text this strip owns: re-rasterised once the web fonts arrive */
  texts(): Phaser.GameObjects.Text[] {
    const out = [this.cardCaption];
    for (const c of this.chips.values()) out.push(c.label, c.value);
    return out;
  }

  private set(id: ChipId, label: string, value: string, color: string, bar?: number) {
    const c = this.chips.get(id)!;
    if (c.label.text !== label) c.label.setText(label);
    if (c.value.text !== value) c.value.setText(value);
    if (c.value.style.color !== color) c.value.setColor(color);
    c.bar = bar;
  }

  draw(sim: Run, now: number, dim: number, warp = 1) {
    this.warp.setVisible(warp > 1);
    const me = sim.me;
    const st = sim.here;
    this.set('cast', 'CAST · 2 / 3', me.weapon === 'smg' ? 'Torrent' : 'Bolt', '#c9b8ff');
    const ready = now >= me.nextNovaAt;
    this.set(
      'stot',
      `STÖT · Q · ${C.NOVA_COST} MANA`,
      ready ? 'Ready' : `${Math.ceil((me.nextNovaAt - now) / 1000)} s`,
      ready ? '#8ef0a8' : '#79849a',
    );
    this.set('kr', 'KRONOR', `${me.money} kr`, me.money < 0 ? '#ff8a6a' : '#ffd23f');
    const party = sim.party;
    this.set(
      'level',
      'LEVEL',
      String(party.level),
      '#edf1f7',
      party.xpNext > 0 ? party.xp / party.xpNext : 0,
    );
    const names = me.laneOrder.map((id) => `${LANE_INFO[id].title}${me.lanes[id] === 2 ? ' II' : ''}`);
    const lanes = [names.slice(0, 2).join(' · '), names.slice(2).join(' · ')].filter(Boolean).join('\n');
    this.set('lanes', lanes ? 'LANES' : '', lanes, '#8cc4f0');
    // LANGAREN'S BOOSTS, while they run (core/bag.ts): the shortest first
    const running = (['cast', 'stot', 'dash'] as const)
      .map((k) => ({ k, left: Math.ceil(((me.boosts[k] ?? 0) - now) / 1000) }))
      .filter((b) => b.left > 0)
      .sort((a, b) => a.left - b.left);
    const BOOST_NAME = { cast: 'Kaffe', stot: 'Nävar', dash: 'Skor' } as const;
    this.set(
      'boost',
      running.length ? 'BOOST' : '',
      [running.slice(0, 2), running.slice(2)]
        .map((row) => row.map((b) => `${BOOST_NAME[b.k]} ${b.left}`).join(' · '))
        .filter(Boolean)
        .join('\n'),
      '#c9b8ff',
    );
    // what this place is doing to you
    const left = st.enemies.filter((e) => e.hp > 0 && e.frame.kind === 'world').length;
    const station = asStation(st);
    const leg = asLeg(st);
    if (!station) {
      this.set(
        'station',
        leg ? `TUNNEL ${shortName(leg.cor.a)} ↔ ${shortName(leg.cor.b)}`.toUpperCase() : 'TUNNEL',
        left > 0 ? `${left} down here` : 'Quiet',
        left > 0 ? '#ff9d9d' : '#79849a',
      );
    } else if (station.cleared) {
      const dark = station.missedTrains >= 2;
      this.set(
        'station',
        'CLEARED · TRAINS MISSED',
        dark ? '☠ The dark' : `${station.missedTrains} of 2`,
        dark ? '#ff6a6a' : '#8ef0a8',
      );
    } else {
      this.set('station', `WAVE ${station.wave} OF ${station.waveTotal}`, `${left} left`, '#ff9d9d');
    }
    this.set('kills', sim.deaths > 0 ? `KILLS · ✝ ${sim.deaths}` : 'KILLS', String(me.kills), '#edf1f7');
    this.layout(dim);
  }

  /** a chip's width: its wider line, and room for its bar */
  private widthOf(c: Chip): number {
    return Math.max(c.label.width, c.value.width + (c.bar !== undefined ? 58 : 0));
  }

  /** chips left to right, each as wide as its wider line; bars under values.
   * Too many for the strip and the gaps close up, never past the edge */
  private layout(dim: number) {
    const key = this.order.map((id) => {
      const c = this.chips.get(id)!;
      return `${c.label.width}|${c.value.width}`;
    });
    const shown = this.order.map((id) => this.chips.get(id)!).filter((c) => !!c.value.text);
    const widths = shown.reduce((a, c) => a + this.widthOf(c), 0);
    const gap = Math.max(10, Math.min(GAP, (RIGHT - CHIPS_X - widths) / Math.max(1, shown.length - 1)));
    let x = CHIPS_X;
    const k = `${key.join(',')}|${gap}`;
    this.bars.clear();
    for (const id of this.order) {
      const c = this.chips.get(id)!;
      const empty = !c.value.text;
      c.label.setVisible(!empty).setAlpha(dim);
      c.value.setVisible(!empty).setAlpha(dim);
      if (empty) continue;
      if (k !== this.layoutKey) {
        c.label.setX(x);
        c.value.setX(x);
      }
      const w = this.widthOf(c);
      if (c.bar !== undefined) {
        const bx = c.label.x + c.value.width + 10;
        const by = C.GAME_HEIGHT - 42;
        this.bars.fillStyle(0x1e2938, dim);
        this.bars.fillRoundedRect(bx, by, 48, 6, 3);
        this.bars.fillStyle(0xffd23f, dim);
        this.bars.fillRoundedRect(bx, by, Math.max(4, 48 * Math.min(1, c.bar)), 6, 3);
      }
      x += w + gap;
    }
    this.layoutKey = k;
    this.cardCaption.setAlpha(dim);
  }
}
