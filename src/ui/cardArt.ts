import Phaser from 'phaser';
import {
  BAND_INFO,
  TIER_INFO,
  ticketById,
  ticketSellPrice,
  type CardTier,
  type Ticket,
} from '../core/cards.ts';
import type { OverlayHost } from './overlays.ts';

/** the SL card and its tickets, drawn: a card face, a paper stub, and the
 * player's card with its stubs loaded on it */

/**
 * A CARD, portrait, the way a travel card sits in a hand: one solid colour
 * with a fine diagonal weave, an emblem, a ring with the card's initial and
 * a single arc beneath, and the words low on the face. It resembles the
 * cards in every Stockholm pocket without being one (§11).
 */
export function drawCard(
  host: OverlayHost,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: number,
  initial: string,
  dark = false,
  alpha = 1,
): Phaser.GameObjects.GameObject[] {
  const g = host.add.graphics().setScrollFactor(0).setDepth(201).setAlpha(alpha);
  const left = cx - w / 2;
  const top = cy - h / 2;
  const r = Math.round(w * 0.07);
  g.fillStyle(dark ? 0x14141a : color, 1);
  g.fillRoundedRect(left, top, w, h, r);
  // the weave: thin diagonals, barely there
  g.lineStyle(1, 0xffffff, dark ? 0.05 : 0.1);
  for (let d = -h; d < w; d += 7) {
    // the line x - y = d, clipped to the face
    const x0 = Math.max(left, left + d);
    const y0 = x0 - d - left + top;
    const x1 = Math.min(left + w, left + d + h);
    const y1 = x1 - d - left + top;
    if (x1 <= x0) continue;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.strokePath();
  }
  g.lineStyle(2, 0xffffff, dark ? 0.35 : 0.55);
  g.strokeRoundedRect(left, top, w, h, r);
  // the emblem: ring, and one arc under it
  const ex = cx;
  const ey = top + h * 0.36;
  const er = w * 0.17;
  g.lineStyle(Math.max(2, w * 0.022), 0xffffff, 0.92);
  g.strokeCircle(ex, ey, er);
  g.beginPath();
  g.arc(ex, ey + er * 0.35, er * 1.55, Math.PI * 0.2, Math.PI * 0.8, false);
  g.strokePath();
  const t = host.add
    .text(ex, ey, initial, {
      fontFamily: 'monospace',
      fontSize: `${Math.round(er * 1.25)}px`,
      color: '#ffffff',
      fontStyle: 'bold',
    })
    .setOrigin(0.5)
    .setScrollFactor(0)
    .setDepth(202)
    .setAlpha(alpha);
  return [g, t];
}

/** a ticket: a paper stub with a band stripe and the words; no emblem, it is not a card */
export function drawTicket(
  host: OverlayHost,
  cx: number,
  cy: number,
  w: number,
  h: number,
  t: Ticket,
  bandLabel: string,
  /** shown instead of the ticket's own words, what a Dubbelbiljett is copying */
  note?: { text: string; color: string },
): Phaser.GameObjects.GameObject[] {
  // above the card face it may be loaded on (the card's weave is at 201)
  const g = host.add.graphics().setScrollFactor(0).setDepth(201.5);
  const left = cx - w / 2;
  const top = cy - h / 2;
  g.fillStyle(0xf2ecd8, 1);
  g.fillRoundedRect(left, top, w, h, 6);
  const stripe = t.band === 'rare' ? 0xc84a3a : t.band === 'mid' ? 0x3a6fc8 : 0x4a9a5a;
  g.fillStyle(stripe, 1);
  g.fillRect(left, top, w, 22);
  // THE PERFORATION IS FOR THE TALL STUBS ONLY, the kiosk's shelf. At
  // 0.72 of an 82 px stub it ran straight through the wrapped description,
  // so every ticket loaded on the card read `_ _ +40% kr _ _` (from play
  // 2026-09-06); moved down, it ran through the sell price instead. There
  // is no room for it in a stub that size, and colour, stripe and border
  // already say paper.
  const short = h < 100;
  if (!short) {
    const perfY = top + h * 0.72;
    g.lineStyle(1, 0x8a8270, 0.6);
    for (let x = left + 8; x < left + w - 8; x += 8) {
      g.beginPath();
      g.moveTo(x, perfY);
      g.lineTo(x + 4, perfY);
      g.strokePath();
    }
  }
  g.lineStyle(2, 0x6a6250, 0.8);
  g.strokeRoundedRect(left, top, w, h, 6);
  const mk = (y: number, text: string, size: number, color: string, bold = false, wrap = 0) =>
    host.add
      .text(cx, y, text, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
        align: 'center',
        ...(wrap ? { wordWrap: { width: wrap } } : {}),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(202);
  return [
    g,
    mk(top + 11, bandLabel, 9, '#ffffff', true),
    mk(top + (short ? 36 : 48), t.title, short ? 12 : 14, '#1a1a22', true),
    note
      ? mk(top + (short ? 56 : h * 0.45), note.text, short ? 9 : 11, note.color, true, w - 18)
      : mk(top + (short ? 56 : h * 0.45), t.desc, short ? 8 : 10, '#2a2a33', false, w - 18),
  ];
}

/** what a loaded card lets you do to its stubs */
export interface CardSlotActions {
  /** click a stub (no drag): sell it */
  sell?: (slot: number) => void;
  /** drag a stub onto another: swap them */
  reorder?: (from: number, to: number) => void;
}

/** the loaded card is PORTRAIT, a card in a hand, with its tickets stacked down it */
export const LOADED_CARD_W = 210;
export const LOADED_CARD_H = 318;
export const LOADED_STUB_W = 176;
export const LOADED_STUB_H = 82;
/** where a loaded card's stub `slot` sits, for a card drawn at cy */
export const loadedStubY = (cy: number, slot: number): number =>
  cy - LOADED_CARD_H / 2 + 34 + LOADED_STUB_H / 2 + slot * (LOADED_STUB_H + 8);

/**
 * WHAT A DUBBELBILJETT IS DOING, said on the stub itself. It copies the
 * ticket below it (core/cards.ts effectiveTickets) and used to show only the
 * rule, so a player holding one had no way to tell whether it had found
 * anything to copy, and the last slot silently did nothing (from play
 * 2026-09-06). Now the stub names its target, or says it has none.
 */
function dubbelNote(ids: readonly string[], slot: number): { text: string; color: string } | undefined {
  if (ids[slot] !== 'dubbel') return undefined;
  const below = ids[slot + 1];
  const t = below && below !== 'dubbel' ? ticketById(below) : undefined;
  return t
    ? { text: `▼ copying ${t.title}`, color: '#1c5a2a' }
    : { text: '▼ nothing below it', color: '#a03a2a' };
}

/**
 * The player's card with its ticket stubs loaded on it.
 *
 * BOTH GESTURES LIVE HERE, so the kiosk and the pause screen cannot drift
 * apart. A stub is dragged onto another to reorder, and clicked to sell,
 * and a drag that ends over a stub must NOT also sell it, which is exactly
 * what the kiosk did (from play 2026-09-06: "I tried to reorder my tickets
 * and instead I sold the one I tried to drag").
 *
 * The hit target is a Rectangle, not a Zone: `setInteractive` with a config
 * object falls back to `setHitAreaFromTexture`, and a Zone has no texture,
 * so the pause screen's drag zones had no hit area at all and nothing there
 * was ever draggable.
 *
 * WHERE A STUB WAS DROPPED is asked of Phaser, not worked out from the
 * pointer. The cameras zoom the design box up to fill the window, so a
 * pointer's x, y are nowhere near the coordinates a scroll-factor-zero
 * overlay is laid out in; `hitTestPointer` is the same hit test the input
 * plugin runs for hover, and it simply answers which stub is under the
 * cursor.
 */
export function drawLoadedCard(
  host: OverlayHost,
  cx: number,
  cy: number,
  tier: CardTier,
  ids: readonly string[],
  actions: CardSlotActions | null,
  showDesc: boolean,
): Phaser.GameObjects.GameObject[] {
  const info = TIER_INFO[tier];
  const W = LOADED_CARD_W;
  const H = LOADED_CARD_H;
  const out = drawCard(host, cx, cy, W, H, info.color, '');
  const stubW = LOADED_STUB_W;
  const stubH = LOADED_STUB_H;
  // a short flick is a click, not a drag, otherwise every click starts one
  host.input.dragDistanceThreshold = 6;
  const canDrag = !!actions?.reorder && ids.length > 1;
  let ghost: Phaser.GameObjects.Text | null = null;
  let dragging = -1;
  /** the drag that just ended, the pointerup it also fires is not a click */
  let dropped = false;
  /** every stub's hit target, so a drop can be resolved to a slot */
  const targets: { slot: number; obj: Phaser.GameObjects.GameObject }[] = [];
  if (canDrag) {
    ghost = host.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#1a1a22',
        backgroundColor: '#f2ecd8',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(220)
      .setVisible(false);
    out.push(ghost);
  }
  for (let slot = 0; slot < info.slots; slot++) {
    const sx = cx;
    const sy = loadedStubY(cy, slot);
    const id = ids[slot];
    const t = id ? ticketById(id) : undefined;
    if (t) {
      out.push(...drawTicket(host, sx, sy, stubW, stubH, t, BAND_INFO[t.band].label, dubbelNote(ids, slot)));
      if (!showDesc) {
        // the stub shows its name only, off the platform
      }
      if (actions) {
        const hit = host.add
          .rectangle(sx, sy, stubW, stubH, 0xffffff, 0.001)
          .setScrollFactor(0)
          .setDepth(203)
          .setInteractive({ useHandCursor: true });
        targets.push({ slot, obj: hit });
        if (canDrag) host.input.setDraggable(hit);
        hit.on('dragstart', () => {
          dragging = slot;
          ghost?.setText(t.title).setVisible(true);
        });
        hit.on('drag', (p: Phaser.Input.Pointer) => {
          ghost?.setPosition(p.x, p.y);
        });
        hit.on('dragend', (p: Phaser.Input.Pointer) => {
          const from = dragging;
          dragging = -1;
          dropped = true;
          ghost?.setVisible(false);
          if (from < 0) return;
          const under = host.input.hitTestPointer(p);
          const onto = targets.find((q) => q.slot !== from && under.includes(q.obj));
          if (onto) actions.reorder?.(from, onto.slot);
        });
        // ...and only a click sells. A drag fires `pointerup` too, right
        // after `dragend`, and that is what sold the ticket the player was
        // trying to move.
        hit.on('pointerdown', () => {
          dropped = false;
        });
        hit.on('pointerup', () => {
          if (dropped || dragging >= 0) return;
          actions.sell?.(slot);
        });
        out.push(hit);
        if (actions.sell)
          out.push(
            host.add
              .text(sx, sy + stubH / 2 - 9, `sell +${ticketSellPrice(t)} kr`, {
                fontFamily: 'monospace',
                fontSize: '8px',
                color: '#2a5a33',
              })
              .setOrigin(0.5)
              .setScrollFactor(0)
              .setDepth(202),
          );
      }
    } else {
      const g = host.add.graphics().setScrollFactor(0).setDepth(201);
      g.lineStyle(1, 0xffffff, 0.5);
      g.strokeRoundedRect(sx - stubW / 2, sy - stubH / 2, stubW, stubH, 6);
      out.push(
        g,
        host.add
          .text(sx, sy, 'empty', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: 'rgba(255,255,255,0.7)',
          })
          .setOrigin(0.5)
          .setScrollFactor(0)
          .setDepth(202),
      );
    }
  }
  return out;
}
