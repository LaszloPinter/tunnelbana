import Phaser from 'phaser';
import * as C from '../config.ts';

export interface MenuHost extends Phaser.Scene {
  uiMode: boolean;
}

const BG = 0x05070c;
const INK = '#e8e8f4';
const DIM = '#78808f';
const LINE = { green: 0x3fae5a, red: 0xd6584f, blue: 0x2f9bd8 } as const;

/**
 * THE LOBBY, hosting, or waiting in somebody else's.
 *
 * A room is a five-letter code. The host picks how many seats and hands out
 * a link; everyone who opens it lands here and watches the seats fill. The
 * host starts when they like. It is deliberately plain: the interesting part
 * of a lobby is knowing who is actually in it.
 */
export interface LobbyView {
  code: string;
  link: string;
  seats: number;
  present: number[];
  youAre: number;
  isHost: boolean;
  status: string;
}

export function showLobby(
  host: MenuHost,
  view: LobbyView,
  actions: { onStart?: () => void; onSeats?: (n: number) => void; onBack: () => void },
): Phaser.GameObjects.GameObject[] {
  host.uiMode = true;
  const g: Phaser.GameObjects.GameObject[] = [];
  const W = C.GAME_WIDTH;
  const H = C.GAME_HEIGHT;
  const text = (x: number, y: number, s: string, size: number, color: string, bold = false, ox = 0.5) =>
    host.add
      .text(x, y, s, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
        align: 'center',
        lineSpacing: 5,
      })
      .setOrigin(ox, 0.5)
      .setScrollFactor(0)
      .setDepth(311);

  g.push(
    host.add
      .rectangle(W / 2, H / 2, W, H, BG, 1)
      .setScrollFactor(0)
      .setDepth(310),
  );
  g.push(text(W / 2, 76, view.isHost ? 'YOUR LOBBY' : 'JOINING', 30, INK, true));

  // the code, big, because it is the thing people read out loud
  const codeBg = host.add.graphics().setScrollFactor(0).setDepth(310.8);
  codeBg.fillStyle(0x0e131c, 1).fillRoundedRect(W / 2 - 210, 118, 420, 78, 10);
  codeBg.lineStyle(2, LINE.blue, 0.8).strokeRoundedRect(W / 2 - 210, 118, 420, 78, 10);
  g.push(codeBg, text(W / 2, 157, view.code, 40, '#9fe0ff', true));
  g.push(text(W / 2, 214, view.link, 11, '#6f7787'));

  // the seats, as a row of platform tiles
  const n = view.seats;
  const tw = 128;
  const gap = 16;
  const sx = W / 2 - (n * tw + (n - 1) * gap) / 2;
  for (let s = 0; s < n; s++) {
    const here = view.present.includes(s);
    const x = sx + s * (tw + gap);
    const tile = host.add.graphics().setScrollFactor(0).setDepth(310.8);
    tile.fillStyle(here ? 0x16202c : 0x0c1017, 1).fillRoundedRect(x, 262, tw, 96, 8);
    tile.lineStyle(2, here ? LINE.green : 0x2a3240, here ? 0.9 : 0.6).strokeRoundedRect(x, 262, tw, 96, 8);
    g.push(
      tile,
      text(x + tw / 2, 296, here ? `SEAT ${s}` : 'EMPTY', 14, here ? INK : '#4d5462', true),
      text(
        x + tw / 2,
        326,
        s === view.youAre ? 'you' : here ? 'ready' : 'waiting…',
        12,
        here ? '#8ef0a8' : '#4d5462',
      ),
    );
  }

  g.push(text(W / 2, 396, view.status, 13, DIM));

  const button = (x: number, y: number, label: string, stroke: number, on: () => void, enabled = true) => {
    const b = host.add
      .rectangle(x, y, 210, 48, enabled ? 0x16202c : 0x0c1017)
      .setScrollFactor(0)
      .setDepth(311)
      .setStrokeStyle(2, enabled ? stroke : 0x2a3240)
      .setInteractive({ useHandCursor: enabled });
    if (enabled) b.on('pointerup', on);
    g.push(b, text(x, y, label, 15, enabled ? INK : '#4d5462', true));
  };

  if (view.isHost && actions.onSeats) {
    // seat count, while nobody has started
    g.push(text(W / 2, 446, 'SEATS', 11, '#5f6774', true));
    [2, 3, 4].forEach((k, i) => {
      const x = W / 2 - 84 + i * 84;
      const on = k === view.seats;
      const b = host.add
        .rectangle(x, 478, 72, 38, on ? 0x16202c : 0x0c1017)
        .setScrollFactor(0)
        .setDepth(311)
        .setStrokeStyle(2, on ? LINE.blue : 0x2a3240)
        .setInteractive({ useHandCursor: true });
      b.on('pointerup', () => actions.onSeats?.(k));
      g.push(b, text(x, 478, String(k), 16, on ? INK : '#6f7787', true));
    });
    if (actions.onStart) {
      button(W / 2 + 150, 552, 'START', LINE.green, () => actions.onStart?.(), true);
      button(W / 2 - 150, 552, 'BACK', 0x6a7280, actions.onBack);
    } else {
      button(W / 2, 552, 'BACK', 0x6a7280, actions.onBack);
    }
  } else {
    button(W / 2, 500, 'LEAVE', 0x6a7280, actions.onBack);
  }

  host.uiMode = false;
  return g;
}

/** five letters, no vowels to misread and no ambiguous glyphs */
/**
 * Which seat this tab takes in a room with no relay.
 *
 * Without one the transport is a BroadcastChannel, which reaches other TABS
 * of this browser and nothing else, enough to play the thing with yourself
 * on two windows, which is worth having and costs no infrastructure at all.
 * Seats are claimed through localStorage because it is the one thing every
 * tab of an origin already shares.
 */
export function claimLocalSeat(code: string, seats: number): number {
  const key = `tb-room-${code}`;
  let taken: number[];
  try {
    taken = JSON.parse(localStorage.getItem(key) ?? '[]') as number[];
  } catch {
    taken = [];
  }
  let seat = 0;
  while (seat < seats && taken.includes(seat)) seat += 1;
  if (seat >= seats) seat = seats - 1;
  try {
    localStorage.setItem(key, JSON.stringify([...taken, seat]));
    // a tab that goes away gives its seat back, so reopening does not exhaust them
    addEventListener('beforeunload', () => {
      try {
        const now = JSON.parse(localStorage.getItem(key) ?? '[]') as number[];
        const i = now.indexOf(seat);
        if (i >= 0) now.splice(i, 1);
        localStorage.setItem(key, JSON.stringify(now));
      } catch {
        /* the seat expires with the browser anyway */
      }
    });
  } catch {
    /* private mode: everyone is seat 0, which still works for one tab */
  }
  return seat;
}
