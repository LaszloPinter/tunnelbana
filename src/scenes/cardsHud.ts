import { openBagScreen } from '../ui/bagScreen.ts';
import Phaser from 'phaser';
import type { ChoiceScreen } from '../ui/overlays.ts';
import * as C from '../config.ts';
import { PERKS } from '../core/perks.ts';
import { TIER_INFO, slotsFor } from '../core/cards.ts';
import { CHOICE } from '../sim/tick.ts';
import type { Player } from '../sim/player.ts';
import {
  drawLoadedCard,
  LOADED_CARD_H,
  openElementChoice,
  openPerkChoice,
  openShopScreen,
  type OverlayHost,
} from '../ui/overlays.ts';

/** the card large, low on the right, clear of the bars along the bottom */
const CARD_CY = C.GAME_HEIGHT - 76 - LOADED_CARD_H / 2;
/** ...and the perk list stacked above its caption, growing upward */
const PERKS_BOTTOM = CARD_CY - LOADED_CARD_H / 2 - 30;

/**
 * The SL card and the perks on screen: the little card by the bars, the
 * card large on TAB or pause (its stubs draggable to reorder), the perk
 * list, and the offer screens, opened when the local seat has an offer up,
 * closed when it is answered. Which click counts is decided here too: the
 * pointer has to be seen UP once after the cards appear, or a held trigger
 * picks a card the instant the popup opens.
 */
export class CardsHud {
  private readonly hudCard: Phaser.GameObjects.Graphics;
  private hudCardKey = '';
  private cardPanel: Phaser.GameObjects.GameObject[] = [];
  private cardPanelKey = '';
  private readonly perkListText: Phaser.GameObjects.Text;
  /** what the cards on screen were drawn from, so a changed shelf is redrawn */
  private choosingKey = '';

  constructor(private readonly host: OverlayHost) {
    host.uiMode = true;
    this.hudCard = host.add.graphics().setScrollFactor(0).setDepth(102);
    // ONE RIGHT-HAND COLUMN, BUILT FROM THE BOTTOM UP: the card sits above
    // the bars and the perk list grows upward from just over it. Both used
    // to be laid out from fixed tops, so a few perks was enough for the list
    // to run down THROUGH the card's own caption (from play 2026-09-06).
    this.perkListText = host.add
      .text(C.GAME_WIDTH - 16, PERKS_BOTTOM, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#c8e0ff',
        align: 'right',
        backgroundColor: '#14141ccc',
        padding: { x: 6, y: 4 },
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(150)
      .setVisible(false);
    host.uiMode = false;
  }

  /**
   * A CLOSED SCREEN IS KEPT, not destroyed. Building one creates a couple
   * of dozen Text objects at once, and every one of those rasterises a
   * canvas and uploads a texture in that single frame, which is the hitch
   * you see opening the kiosk twice (from play 2026-09-05). The screen is
   * hidden and its clicks are switched off instead, and reopening the same
   * shelf shows it again. Its handlers are index-based, so the same screen
   * serves the same content whatever offer object carries it.
   */
  private readonly kept = new Map<string, ChoiceScreen>();

  private static wake(screen: ChoiceScreen, on: boolean) {
    for (const g of screen.gfx) {
      const o = g as Phaser.GameObjects.GameObject &
        Partial<Phaser.GameObjects.Components.Visible> & { input?: { enabled: boolean } };
      o.setVisible?.(on);
      if (o.input) o.input.enabled = on;
    }
  }

  /** a fresh run keeps nothing: the cards, the money and the shelf are new */
  clearKept() {
    for (const screen of this.kept.values()) for (const g of screen.gfx) g.destroy();
    this.kept.clear();
  }

  closeChoice() {
    const host = this.host;
    if (!host.choosing) return;
    const key = this.choosingKey;
    CardsHud.wake(host.choosing, false);
    if (key) {
      const had = this.kept.get(key);
      if (had && had !== host.choosing) for (const g of had.gfx) g.destroy();
      this.kept.set(key, host.choosing);
      // a handful is plenty: the screens you actually reopen are recent
      while (this.kept.size > 4) {
        const oldest = this.kept.keys().next().value as string;
        const screen = this.kept.get(oldest)!;
        for (const g of screen.gfx) g.destroy();
        this.kept.delete(oldest);
      }
    } else {
      for (const g of host.choosing.gfx) g.destroy();
    }
    host.choosing = null;
  }

  /** keep the cards on screen in step with the local seat's offer */
  syncChoice() {
    const host = this.host;
    const me = host.me;
    const offer = me.offer;
    // the kiosk's shelf shrinks as you buy: redraw it when it changes
    const key = offer ? `${offer.kind}:${offer.items.join(',')}|${me.cards.join(',')}|${me.money}` : '';
    if (host.choosing && key !== this.choosingKey) this.closeChoice();
    if (offer && !host.choosing) {
      const kept = this.kept.get(key);
      if (kept) {
        this.kept.delete(key);
        CardsHud.wake(kept, true);
        kept.armed = false;
        host.choosing = kept;
      } else if (offer.kind === 'element') openElementChoice(host, offer);
      else if (offer.kind === 'shop') openShopScreen(host, offer);
      else if (offer.kind === 'bag') openBagScreen(host, offer);
      else openPerkChoice(host, offer);
      this.choosingKey = key;
      this.refreshPerkList(me);
    } else if (!offer && host.choosing) {
      this.closeChoice();
      this.refreshPerkList(me);
    }
    if (host.choosing && !host.input.activePointer.isDown) host.choosing.armed = true;
  }

  /** every frame: the little card, the big card while shown, the perk list */
  draw(me: Player, showPanel: boolean) {
    this.perkListText.setVisible(showPanel && me.perkCounts.size > 0);
    this.refreshHudCard(me);
    this.refreshCardPanel(me, showPanel);
  }

  /** the little card by the bars, redrawn only when what it shows changes */
  private refreshHudCard(me: Player) {
    const key = `${me.cardTier}:${me.cards.join(',')}`;
    if (key === this.hudCardKey) return;
    this.hudCardKey = key;
    const g = this.hudCard;
    g.clear();
    // portrait, always: a card in a hand, its stubs stacked down it
    const x = 340;
    const w = 44;
    const h = 66;
    const y = C.GAME_HEIGHT - 84;
    g.fillStyle(TIER_INFO[me.cardTier].color, 1);
    g.fillRoundedRect(x, y, w, h, 5);
    g.lineStyle(1.5, 0xffffff, 0.6);
    g.strokeRoundedRect(x, y, w, h, 5);
    const slots = slotsFor(me.cardTier);
    for (let i = 0; i < slots; i++) {
      const sy = y + 8 + i * 18;
      if (me.cards[i]) g.fillStyle(0xf2ecd8, 1);
      else g.fillStyle(0xffffff, 0.25);
      g.fillRoundedRect(x + 10, sy, 24, 14, 2);
    }
  }

  /** the card large, on TAB or pause: drag a ticket onto another to reorder */
  private refreshCardPanel(me: Player, show: boolean) {
    const key = show ? `${me.cardTier}:${me.cards.join(',')}` : '';
    if (key === this.cardPanelKey) return;
    this.cardPanelKey = key;
    for (const g of this.cardPanel) g.destroy();
    this.cardPanel = [];
    if (!show) return;
    const host = this.host;
    host.uiMode = true;
    const cx = C.GAME_WIDTH - 150;
    const cy = CARD_CY;
    // no selling here, this is the pause screen, not the kiosk
    this.cardPanel.push(
      ...drawLoadedCard(
        host,
        cx,
        cy,
        me.cardTier,
        me.cards,
        {
          reorder: (from, to) => host.choose(CHOICE.swap(from, to)),
        },
        true,
      ),
    );
    this.cardPanel.push(
      host.add
        .text(
          cx,
          cy - LOADED_CARD_H / 2 - 16,
          `${TIER_INFO[me.cardTier].label} · ${me.cards.length}/${slotsFor(me.cardTier)} · drag to reorder`,
          { fontFamily: 'monospace', fontSize: '11px', color: '#c8d0e0' },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(202),
    );
    host.uiMode = false;
  }

  private refreshPerkList(me: Player) {
    const lines: string[] = ['PERKS'];
    for (const [id, n] of me.perkCounts) {
      const perk = PERKS.find((pk) => pk.id === id);
      if (perk) lines.push(`${perk.title}${n > 1 ? ` ×${n}` : ''}`);
    }
    this.perkListText.setText(lines.join('\n'));
  }
}
