import Phaser from 'phaser';
import * as C from '../config.ts';
import type { RouteLeg } from '../core/network.ts';
import { type Party, type Player } from '../sim/player.ts';
import { touch } from './dom/touch.ts';

/**
 * The screens that stop the world: the briefing a run starts from, and the
 * host every overlay reads. The cards themselves are ui/cardArt.ts, the
 * kiosk ui/shopScreen.ts, the level-up and lane picks ui/pickScreens.ts.
 * They only READ the run, what a pick DOES is the simulation's business,
 * and arrives there as `TickInput.choice`.
 */

/** what an overlay needs of the run it is describing */
export interface OverlayHost extends Phaser.Scene {
  station: string;
  destStation: string;
  route: RouteLeg[];
  startScreen: Phaser.GameObjects.GameObject[] | null;
  /** the seat whose screens these are */
  me: Player;
  party: Party;
  gameNow: number;
  uiMode: boolean;
  /** the screen showing the local seat's offer, while one is up */
  choosing: ChoiceScreen | null;
  beginRun(): void;
  /** the local seat's pick, queued as input, applied by the next tick */
  choose(code: number): void;
}

/**
 * The picture of an offer. Which click COUNTS is the screen's business: the
 * pointer has to go up once after the cards appear (a held trigger is not a
 * pick) and a beat of wall time has to pass (the click that was still
 * landing when the level came is not a pick either). What the pick DOES is
 * the simulation's, and arrives there as `TickInput.choice`.
 */
export interface ChoiceScreen {
  gfx: Phaser.GameObjects.GameObject[];
  openedWall: number;
  armed: boolean;
  /** what can be picked, left to right, for a pad's cursor (scenes/DemoScene.ts padChoice) */
  slots: ChoiceSlot[];
  cursor: number;
  /** the pad's highlight, made when first needed; lives in gfx */
  frame: Phaser.GameObjects.Rectangle | null;
  /** the pad's B and Y, when the screen has them */
  skip?: number;
  reroll?: number;
}

export interface ChoiceSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  code: number;
}

/** pre-run briefing: where you are, where you're going, and how */
export function showStartScreen(host: OverlayHost) {
  if (host.startScreen) for (const g of host.startScreen) g.destroy();
  host.uiMode = true;
  const gfx: Phaser.GameObjects.GameObject[] = [];
  const capital = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
  gfx.push(
    host.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0x05070c, 0.92)
      .setScrollFactor(0)
      .setDepth(300),
    host.add
      .text(C.GAME_WIDTH / 2, 118, 'TUNNELBANA', {
        fontFamily: 'monospace',
        fontSize: '46px',
        color: '#e8e8f4',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301),
    host.add
      .text(C.GAME_WIDTH / 2, 162, 'get where you are going', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#8a90a0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301),
    host.add
      .text(C.GAME_WIDTH / 2, 236, `${host.station}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffd23f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301),
    host.add
      .text(C.GAME_WIDTH / 2, 272, '▼', { fontFamily: 'monospace', fontSize: '20px', color: '#6a7280' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301),
    host.add
      .text(C.GAME_WIDTH / 2, 308, `${host.destStation}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#8ef0a8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(301),
  );
  host.route.forEach((l, i) => {
    gfx.push(
      host.add
        .text(
          C.GAME_WIDTH / 2,
          356 + i * 24,
          `${i + 1}.  ${capital(l.service.color)} ${l.service.id} → ${l.to}  (${l.stops} stop${l.stops > 1 ? 's' : ''})`,
          { fontFamily: 'monospace', fontSize: '15px', color: '#c8d0dc' },
        )
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(301),
    );
  });
  const btnY = 356 + Math.max(1, host.route.length) * 24 + 44;
  const btn = host.add
    .rectangle(C.GAME_WIDTH / 2, btnY, 240, 52, 0x1c6b3c)
    .setScrollFactor(0)
    .setDepth(301)
    .setStrokeStyle(3, 0x8ef0a8)
    .setInteractive({ useHandCursor: true });
  btn.once('pointerup', () => host.beginRun());
  gfx.push(
    btn,
    host.add
      .text(C.GAME_WIDTH / 2, btnY, 'START', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#eaffe8',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(302),
    host.add
      .text(
        C.GAME_WIDTH / 2,
        btnY + 48,
        (touch.active
          ? [
              'LEFT THUMB walk   ·   DASH   ·   casting is automatic',
              'STÖT the shockwave   ·   ⇄ bolt / torrent   ·   E kiosk / exit',
              'CARD your perks   ·   II pause',
            ]
          : [
              'WASD move   ·   SPACE dash   ·   MOUSE aim & cast',
              'RMB / Q STÖT   2 bolt   3 torrent   ·   E buy / exit',
              'TAB perks   ·   G guide   ·   P pause & controls   ·   R restart',
            ]
        ).join('\n'),
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#5f6774',
          align: 'center',
          lineSpacing: 4,
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(301),
  );
  host.startScreen = gfx;
  host.uiMode = false;
}

/** the pick counts only once the pointer has been up since the cards appeared */
export const armedClick = (host: OverlayHost) => {
  const ch = host.choosing;
  return !!ch && ch.armed && Date.now() > ch.openedWall + 400;
};

export {
  drawLoadedCard,
  loadedStubY,
  LOADED_CARD_H,
  LOADED_CARD_W,
  LOADED_STUB_H,
  LOADED_STUB_W,
} from './cardArt.ts';
export { openShopScreen } from './shopScreen.ts';
export { openElementChoice, openPerkChoice } from './pickScreens.ts';
