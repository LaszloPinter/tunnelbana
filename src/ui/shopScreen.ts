import * as C from '../config.ts';
import { CHOICE } from '../sim/tick.ts';
import type { Offer } from '../sim/player.ts';
import {
  BAND_INFO,
  NEXT_TIER,
  TIER_INFO,
  kioskMul,
  slotsFor,
  ticketById,
  ticketPrice,
  type Ticket,
} from '../core/cards.ts';
import { armedClick, type OverlayHost, type ChoiceSlot } from './overlays.ts';
import { drawCard, drawLoadedCard, drawTicket, LOADED_CARD_H } from './cardArt.ts';

/** the kiosk: the shelf of SL cards above, your held cards (and their sell price) below */
export function openShopScreen(host: OverlayHost, offer: Offer) {
  host.uiMode = true;
  const gfx: Phaser.GameObjects.GameObject[] = [];
  const T = (
    x: number,
    y: number,
    text: string,
    size: number,
    color: string,
    originX = 0.5,
    bold = false,
    wrap = 0,
  ) => {
    const t = host.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
        align: 'center',
        ...(wrap ? { wordWrap: { width: wrap } } : {}),
      })
      .setOrigin(originX, 0.5)
      .setScrollFactor(0)
      .setDepth(202);
    gfx.push(t);
    return t;
  };
  gfx.push(
    host.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0x000000, 0.6)
      .setScrollFactor(0)
      .setDepth(200),
  );
  T(C.GAME_WIDTH / 2, 140, `KIOSK: station cleared   ·   ${host.me.money} kr`, 18, '#ffd23f', 0.5, true);
  // the shelf: three tickets standing up, and the next card if there is one
  const discount = kioskMul(host.me);
  const shelf = offer.items.map(ticketById).filter((t): t is Ticket => !!t);
  const next = NEXT_TIER[host.me.cardTier];
  const n = shelf.length + (next ? 1 : 0);
  const W = 150;
  const H = 220;
  const CY = 290;
  const slotX = (i: number) => C.GAME_WIDTH / 2 - 120 + (i - (n - 1) / 2) * 170;
  const slots: ChoiceSlot[] = [];
  shelf.forEach((t, i) => {
    const cx = slotX(i);
    slots.push({ x: cx, y: CY, w: W, h: H, code: CHOICE.card(i) });
    const band = BAND_INFO[t.band];
    const price = ticketPrice(t, discount);
    const short = host.me.money < price;
    const full = host.me.cards.length >= slotsFor(host.me.cardTier);
    // a ticket is a stub: paper, a band stripe, the words
    gfx.push(...drawTicket(host, cx, CY, W, H, t, band.label));
    const top = CY - H / 2;
    // dark on the stub's paper: white was unreadable on it
    T(cx, top + H - 30, `${price} kr`, 14, short ? '#b8442f' : '#2a2c34', 0.5, true);
    if (full) T(cx, top + H - 14, 'card full', 9, '#b8442f');
    else if (short) T(cx, top + H - 14, 'not enough kr', 9, '#b8442f');
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
  if (next) {
    const cx = slotX(shelf.length);
    slots.push({ x: cx, y: CY, w: W, h: H, code: CHOICE.upgrade });
    const info = TIER_INFO[next];
    const price = Math.round(info.price * discount);
    gfx.push(...drawCard(host, cx, CY, W, H, info.color, ''));
    const top = CY - H / 2;
    T(cx, top + 16, info.label, 9, 'rgba(255,255,255,0.8)', 0.5, true);
    T(cx, top + H * 0.62, `${info.slots} TICKETS`, 15, '#ffffff', 0.5, true);
    T(cx, top + H * 0.62 + 22, 'a bigger card', 10, 'rgba(255,255,255,0.85)');
    T(cx, top + H - 30, `${price} kr`, 13, host.me.money < price ? '#ffb090' : '#ffffff', 0.5, true);
    const hit = host.add
      .rectangle(cx, CY, W, H, 0xffffff, 0.001)
      .setScrollFactor(0)
      .setDepth(203)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      if (armedClick(host)) host.choose(CHOICE.upgrade);
    });
    gfx.push(hit);
  }
  // your card, standing to the right with its tickets loaded: click a ticket to sell it
  const tier = TIER_INFO[host.me.cardTier];
  const cardX = C.GAME_WIDTH - 170;
  // both captions hang off the card's OWN centre; measured from the shelf's
  // they sat inside the card face (from play 2026-09-06)
  const cardY = CY + 20;
  T(
    cardX,
    cardY - LOADED_CARD_H / 2 - 16,
    `${tier.label} · ${host.me.cards.length}/${tier.slots}`,
    11,
    '#9aa3b2',
  );
  T(cardX, cardY + LOADED_CARD_H / 2 + 16, 'click a ticket to sell · drag to reorder', 10, '#9aa3b2');
  gfx.push(
    ...drawLoadedCard(
      host,
      cardX,
      cardY,
      host.me.cardTier,
      host.me.cards,
      {
        sell: (slot) => {
          if (armedClick(host)) host.choose(CHOICE.sell(slot));
        },
        reorder: (from, to) => {
          if (armedClick(host)) host.choose(CHOICE.swap(from, to));
        },
      },
      true,
    ),
  );
  const btn = host.add
    .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT - 150, 190, 38, 0x22262f)
    .setScrollFactor(0)
    .setDepth(201)
    .setStrokeStyle(2, 0x6a9a5a)
    .setInteractive({ useHandCursor: true });
  btn.on('pointerup', () => {
    if (armedClick(host)) host.choose(CHOICE.skip);
  });
  gfx.push(btn);
  // clear of the HUD's status strip along the bottom (scenes/hudStatus.ts)
  T(C.GAME_WIDTH / 2, C.GAME_HEIGHT - 150, 'LEAVE (E)', 13, '#d0d4e0');
  host.choosing = {
    gfx,
    openedWall: Date.now(),
    armed: false,
    slots,
    cursor: 0,
    frame: null,
    skip: CHOICE.skip,
  };
  host.uiMode = false;
}
