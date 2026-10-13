import Phaser from 'phaser';
import * as C from '../config.ts';
import { PERK_CAT_INFO, PERKS, perkMaxed, type Perk } from '../core/perks.ts';
import { CHOICE } from '../sim/tick.ts';
import type { Offer } from '../sim/player.ts';
import { laneCard } from '../core/lanes.ts';
import { armedClick, type ChoiceSlot, type OverlayHost } from './overlays.ts';

/** the level-up's cards and the lane pick, the screens a party stands still for (§16) */

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function openPerkChoice(host: OverlayHost, offer: Offer) {
  const picks = offer.items.map((id) => PERKS.find((pk) => pk.id === id)).filter((pk): pk is Perk => !!pk);
  const canReroll = offer.canReroll;
  host.uiMode = true;
  const gfx: Phaser.GameObjects.GameObject[] = [];
  gfx.push(
    host.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0x000000, 0.72)
      .setScrollFactor(0)
      .setDepth(200),
    host.add
      .text(
        C.GAME_WIDTH / 2,
        302,
        `LEVEL ${host.party.level}   ·   ${host.me.money < 0 ? `${-host.me.money} kr owed` : `${host.me.money} kr`}`,
        { fontFamily: 'monospace', fontSize: '15px', color: '#ffd23f', fontStyle: 'bold' },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201),
  );
  // ONE TIGHT CLUSTER (from play, twice: tall cards, then wide panels flung
  // across the screen, either way the eye travelled). Narrow panels, a
  // small gap, everything centred: the title, then the change as one line.
  const W = 188;
  const H = 96;
  const CY = 372;
  const gap = W + 10;
  const slots: ChoiceSlot[] = [];
  picks.forEach((perk, i) => {
    const cx = C.GAME_WIDTH / 2 + (i - (picks.length - 1) / 2) * gap;
    const catInfo = PERK_CAT_INFO[perk.cat];
    const stacks = host.me.perkCounts.get(perk.id) ?? 0;
    const stats = perk.stats(host.me.mods);
    // AT ITS CEILING the card is still dealt, greyed and marked MAX, and
    // does nothing when clicked (the sim refuses it too, progression.ts)
    const maxed = perkMaxed(perk, host.me.mods);
    const tint = maxed ? 0x4a4f5a : catInfo.color;
    const top = CY - H / 2;
    const g = host.add.graphics().setScrollFactor(0).setDepth(201);
    g.fillStyle(maxed ? 0x0c0e12 : 0x10141c, 0.98);
    g.fillRoundedRect(cx - W / 2, top, W, H, 8);
    g.fillStyle(tint, 1);
    g.fillRoundedRect(cx - W / 2, top, W, 5, { tl: 8, tr: 8, bl: 0, br: 0 });
    g.lineStyle(1.5, tint, 0.55);
    g.strokeRoundedRect(cx - W / 2, top, W, H, 8);
    gfx.push(g);
    const T = (x: number, y: number, text: string, size: number, color: string, bold = false) =>
      host.add
        .text(x, y, text, {
          fontFamily: 'monospace',
          fontSize: `${size}px`,
          color,
          fontStyle: bold ? 'bold' : 'normal',
          align: 'center',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(202);
    gfx.push(T(cx, top + 32, perk.title, 16, maxed ? '#6b7080' : '#ffffff', true));
    // the change, centred, no label, the title already says what it is
    const lines = stats.slice(0, 2).map((st) => `${st.from} → ${st.to}`);
    if (maxed) gfx.push(T(cx, top + 62, 'MAX', 14, '#8a8f9a', true));
    else gfx.push(T(cx, top + 62, lines.join('   ·   '), lines.length > 1 ? 11 : 14, '#ffe9a0', true));
    if (stacks > 0) gfx.push(T(cx + W / 2 - 16, top + 16, `×${stacks}`, 9, 'rgba(255,255,255,0.55)'));
    if (maxed) return;
    slots.push({ x: cx, y: CY, w: W, h: H, code: CHOICE.card(i) });
    const hit = host.add
      .rectangle(cx, CY, W, H, 0xffffff, 0.001)
      .setScrollFactor(0)
      .setDepth(203)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      if (armedClick(host)) host.choose(CHOICE.card(i));
    });
    gfx.push(hit);
  });

  // bottom row: reroll (free, once) and skip-for-cash
  const mkButton = (bx: number, label: string, stroke: number, cb: () => void) => {
    const btn = host.add
      .rectangle(bx, 448, 170, 32, 0x22262f)
      .setScrollFactor(0)
      .setDepth(201)
      .setStrokeStyle(2, stroke)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerup', () => {
      if (armedClick(host)) cb();
    });
    gfx.push(
      btn,
      host.add
        .text(bx, 448, label, { fontFamily: 'monospace', fontSize: '12px', color: '#d0d4e0' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(202),
    );
  };
  if (canReroll) mkButton(C.GAME_WIDTH / 2 - 95, 'REROLL (once)', 0x8a6ad0, () => host.choose(CHOICE.reroll));
  mkButton(C.GAME_WIDTH / 2 + 95, 'SKIP · pocket 25 kr', 0x6a9a5a, () => host.choose(CHOICE.skip));
  host.choosing = {
    gfx,
    openedWall: Date.now(),
    armed: false,
    slots,
    cursor: 0,
    frame: null,
    skip: CHOICE.skip,
    reroll: canReroll ? CHOICE.reroll : undefined,
  };
  host.uiMode = false;
}

export function openElementChoice(host: OverlayHost, offer: Offer) {
  const cards = offer.items.map(laneCard);
  const header = host.me.laneOrder.length === 0 ? 'CHOOSE YOUR LANE' : 'DEEPEN OR BROADEN';
  host.uiMode = true;
  const gfx: Phaser.GameObjects.GameObject[] = [];
  gfx.push(
    host.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0x000000, 0.6)
      .setScrollFactor(0)
      .setDepth(200),
    host.add
      .text(C.GAME_WIDTH / 2, 268, `LEVEL ${host.party.level}: ${header}`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#e8d8ff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201),
  );
  // SORCERY, not a card (from play: the card face made these unreadable and
  // made them look like tickets). A dark panel per lane, the lane's colour
  // as the glyph and a glow, the title big, the words readable
  const many = cards.length > 4;
  const W = many ? 196 : 232;
  const H = 214;
  const gap = W + 12;
  const CY = 400;
  const slots: ChoiceSlot[] = [];
  cards.forEach((card, i) => {
    const cx = C.GAME_WIDTH / 2 + (i - (cards.length - 1) / 2) * gap;
    slots.push({ x: cx, y: CY, w: W, h: H, code: CHOICE.card(i) });
    const top = CY - H / 2;
    const g = host.add.graphics().setScrollFactor(0).setDepth(201);
    g.fillStyle(card.color, 0.18);
    g.fillRoundedRect(cx - W / 2 - 3, top - 3, W + 6, H + 6, 12);
    g.fillStyle(0x10141c, 0.98);
    g.fillRoundedRect(cx - W / 2, top, W, H, 10);
    g.lineStyle(2, card.color, 0.9);
    g.strokeRoundedRect(cx - W / 2, top, W, H, 10);
    // the sigil: a ring in the lane's colour with its letter
    g.lineStyle(3, card.color, 1);
    g.strokeCircle(cx, top + 44, 24);
    gfx.push(g);
    const T = (y: number, text: string, size: number, color: string, bold = false, wrap = 0, originY = 0.5) =>
      host.add
        .text(cx, y, text, {
          fontFamily: 'monospace',
          fontSize: `${size}px`,
          color,
          fontStyle: bold ? 'bold' : 'normal',
          align: 'center',
          ...(wrap ? { wordWrap: { width: wrap } } : {}),
        })
        .setOrigin(0.5, originY)
        .setScrollFactor(0)
        .setDepth(202);
    gfx.push(
      T(top + 44, card.title[0], 22, hex(card.color), true),
      T(top + 92, card.title, many ? 16 : 18, '#ffffff', true),
      T(top + 112, card.desc, many ? 10 : 11, '#d4dbe8', false, W - 24, 0),
    );
    const hit = host.add
      .rectangle(cx, CY, W, H, 0xffffff, 0.001)
      .setScrollFactor(0)
      .setDepth(203)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      if (armedClick(host)) host.choose(CHOICE.card(i));
    });
    gfx.push(hit);
  });
  host.choosing = { gfx, openedWall: Date.now(), armed: false, slots, cursor: 0, frame: null };
  host.uiMode = false;
}
