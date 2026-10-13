import * as C from '../config.ts';
import { CHOICE } from '../sim/tick.ts';
import type { Offer } from '../sim/player.ts';
import { BAG_ITEMS } from '../core/bag.ts';
import { ticketById, type Ticket } from '../core/cards.ts';
import { priceOf } from '../combat/langaren.ts';
import { armedClick, type OverlayHost, type ChoiceSlot } from './overlays.ts';
import { drawTicket } from './cardArt.ts';

/**
 * LANGAREN'S BAG, open (DESIGN §20; combat/langaren.ts decides what a pick
 * does). The kiosk's stubs, darker, and nothing on it says "shop": a bag,
 * what is in it, and what he wants for it. LEAVE or E closes it.
 */
const none = () => {};
/** clear of the HUD's status strip along the bottom (scenes/hudStatus.ts) */
const LEAVE_Y = C.GAME_HEIGHT - 150;
function asStub(id: string): { t: Ticket; label: string } | null {
  if (id.startsWith('ticket:')) {
    const t = ticketById(id.slice(7));
    return t ? { t, label: 'UNDER DISKEN' } : null;
  }
  const it = BAG_ITEMS[id];
  if (!it) return null;
  const label = id === 'special' ? 'SVARTA KORTET' : id === 'mana' ? 'MANA' : 'EN STUND';
  return { t: { id, title: it.title, band: 'rare', desc: it.desc, apply: none }, label };
}

export function openBagScreen(host: OverlayHost, offer: Offer) {
  host.uiMode = true;
  const gfx: Phaser.GameObjects.GameObject[] = [];
  const T = (x: number, y: number, text: string, size: number, color: string, bold = false) => {
    const t = host.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(202);
    gfx.push(t);
    return t;
  };
  gfx.push(
    host.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0x05060a, 0.72)
      .setScrollFactor(0)
      .setDepth(200),
  );
  T(C.GAME_WIDTH / 2, 132, `PÅSEN   ·   ${host.me.money} kr`, 18, '#c9b8ff', true);
  T(C.GAME_WIDTH / 2, 158, 'Inga frågor. Inga kvitton.', 12, '#8a90a0');
  const W = 150;
  const H = 220;
  const CY = 310;
  const n = offer.items.length;
  const slotX = (i: number) => C.GAME_WIDTH / 2 + (i - (n - 1) / 2) * 170;
  const slots: ChoiceSlot[] = [];
  offer.items.forEach((id, i) => {
    const stub = asStub(id);
    if (!stub) return;
    const cx = slotX(i);
    slots.push({ x: cx, y: CY, w: W, h: H, code: CHOICE.card(i) });
    const price = priceOf(id);
    gfx.push(...drawTicket(host, cx, CY, W, H, stub.t, stub.label));
    T(cx, CY + H / 2 - 30, `${price} kr`, 14, host.me.money < price ? '#b8442f' : '#2a2c34', true);
    if (host.me.money < price) T(cx, CY + H / 2 - 14, 'not enough kr', 9, '#b8442f');
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
  const btn = host.add
    .rectangle(C.GAME_WIDTH / 2, LEAVE_Y, 190, 38, 0x22262f)
    .setScrollFactor(0)
    .setDepth(201)
    .setStrokeStyle(2, 0x7a5aa0)
    .setInteractive({ useHandCursor: true });
  btn.on('pointerup', () => {
    if (armedClick(host)) host.choose(CHOICE.skip);
  });
  gfx.push(btn);
  T(C.GAME_WIDTH / 2, LEAVE_Y, 'LEAVE (E)', 13, '#d0d4e0');
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
