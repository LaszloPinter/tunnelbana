import './avatar.css';
import { el } from './menuBuild.ts';
import { randomPlayerName } from './names.ts';
import {
  BUILDS,
  HAIR_STYLES,
  HATS,
  PALETTE,
  css,
  drawLook,
  randomLook,
  type PlayerLook,
} from '../../render/look.ts';

/**
 * YOUR COMMUTER, on the landing. The corner card used to be a bare name
 * with "PLAYING AS · ON THE BOARD" over it, and players did not know the
 * random words were them (from the alpha UX pass, 2026-09-30). Now it shows
 * who you are, the figure you walk around as, and the name the board and
 * the end screen call you, with a shuffle and a Customise dialog:
 * name, build, skin, hair and its style, headwear, top and trousers.
 * Everything is a preference (src/save.ts), never simulation state.
 */
export interface AvatarState {
  name: string;
  look: PlayerLook;
}

export interface AvatarParts {
  card: HTMLElement;
  dialog: HTMLDialogElement;
  /** repaint from the outside (the account renamed us) */
  set(s: Partial<AvatarState>): void;
}

const LABEL: Record<string, string> = {
  short: 'Short',
  buzz: 'Buzz',
  long: 'Long',
  ponytail: 'Ponytail',
  bun: 'Bun',
  none: 'None',
  beanie: 'Beanie',
  cap: 'Cap',
  slim: 'Slim',
  regular: 'Regular',
  broad: 'Broad',
};

function preview(size: number): HTMLCanvasElement {
  const c = el('canvas', 'tb-av-canvas');
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  c.width = size * dpr;
  c.height = size * dpr;
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  return c;
}

function paint(c: HTMLCanvasElement, look: PlayerLook) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  // the figure is about 1.3 m across; leave it room to breathe
  drawLook(ctx, look, c.width / 2, c.height / 2 + c.height * 0.04, c.width / 1.75);
}

export function buildAvatar(
  initial: AvatarState,
  on: { name(n: string): void; look(l: PlayerLook): void },
): AvatarParts {
  let state: AvatarState = { ...initial, look: { ...initial.look } };

  // ---- the card in the corner ----
  const card = el('div', 'tb-card tb-av-card');
  const small = preview(64);
  small.title = 'Customise your commuter';
  const side = el('div', 'tb-av-side');
  const label = el('div', 'tb-av-label', 'YOUR COMMUTER');
  const nameLine = el('div', 'tb-av-name');
  const hint = el('div', 'tb-card-hint', 'Your name on the daily board');
  const btns = el('div', 'tb-av-btns');
  const shuffle = el('button', 'tb-btn tb-av-small', '🎲 Shuffle');
  shuffle.title = 'A new look and a new name';
  const edit = el('button', 'tb-btn tb-av-small', 'Customise');
  btns.append(shuffle, edit);
  side.append(label, nameLine, hint, btns);
  const face = el('button', 'tb-av-face');
  face.setAttribute('aria-label', 'Customise your commuter');
  face.append(small);
  card.append(face, side);

  // ---- the dialog ----
  const dialog = el('dialog', 'tb-av-dialog');
  dialog.id = 'tb-avatar';
  const head = el('div', 'tb-panel-head');
  const done = el('button', 'tb-btn tb-btn-amber', 'Done');
  head.append(el('h2', undefined, 'Your commuter'), done);
  const body = el('div', 'tb-panel-body tb-av-body');
  const big = preview(168);
  const stage = el('div', 'tb-av-stage');
  const dice = el('button', 'tb-btn', '🎲 Shuffle look');
  stage.append(big, dice);
  const form = el('div', 'tb-av-form');

  const nameRow = el('div', 'tb-av-row');
  const nameIn = el('input', 'tb-name tb-av-input');
  nameIn.maxLength = 24;
  nameIn.setAttribute('aria-label', 'Your name');
  const reName = el('button', 'tb-icon', '🎲');
  reName.title = 'Another name';
  nameRow.append(el('span', 'tb-av-key', 'Name'), nameIn, reName);
  form.append(nameRow);

  const repaints: (() => void)[] = [];
  const swatches = (title: string, key: keyof PlayerLook, colours: number[]) => {
    const row = el('div', 'tb-av-row');
    const wrap = el('div', 'tb-av-swatches');
    for (const c of colours) {
      const b = el('button', 'tb-av-sw');
      b.style.background = css(c);
      b.setAttribute('aria-label', `${title} ${css(c)}`);
      b.addEventListener('click', () => set({ look: { ...state.look, [key]: c } }, true));
      wrap.append(b);
      repaints.push(() => b.classList.toggle('is-on', state.look[key] === c));
    }
    row.append(el('span', 'tb-av-key', title), wrap);
    form.append(row);
  };
  const chips = <T extends string | boolean>(
    title: string,
    key: keyof PlayerLook,
    values: T[],
    name = (v: T) => LABEL[String(v)] ?? String(v),
  ) => {
    const row = el('div', 'tb-av-row');
    const wrap = el('div', 'tb-av-chips');
    for (const v of values) {
      const b = el('button', 'tb-av-chip', name(v));
      b.addEventListener('click', () => set({ look: { ...state.look, [key]: v } }, true));
      wrap.append(b);
      repaints.push(() => b.classList.toggle('is-on', state.look[key] === v));
    }
    row.append(el('span', 'tb-av-key', title), wrap);
    form.append(row);
  };
  chips('Build', 'build', BUILDS);
  swatches('Skin', 'skin', PALETTE.skin);
  chips('Hair', 'hairStyle', HAIR_STYLES);
  swatches('Hair colour', 'hair', PALETTE.hair);
  chips('On your head', 'hat', HATS);
  swatches('Hat colour', 'hatColor', PALETTE.hatColor);
  chips('Headphones', 'headphones', [true, false], (v) => (v ? 'On' : 'Off'));
  swatches('Top', 'top', PALETTE.top);
  swatches('Trousers', 'trousers', PALETTE.trousers);

  body.append(stage, form);
  dialog.append(head, body);

  function set(patch: Partial<AvatarState>, save = false) {
    state = { ...state, ...patch };
    nameLine.textContent = state.name;
    if (document.activeElement !== nameIn) nameIn.value = state.name;
    paint(small, state.look);
    paint(big, state.look);
    for (const r of repaints) r();
    if (save && patch.look) on.look(state.look);
    if (save && patch.name !== undefined) on.name(state.name);
  }

  // ---- wiring ----
  const openDialog = () => {
    dialog.showModal();
    set({});
  };
  face.addEventListener('click', openDialog);
  edit.addEventListener('click', openDialog);
  done.addEventListener('click', () => dialog.close());
  shuffle.addEventListener('click', () => set({ look: randomLook(), name: randomPlayerName() }, true));
  dice.addEventListener('click', () => set({ look: randomLook() }, true));
  reName.addEventListener('click', () => set({ name: randomPlayerName() }, true));
  // Phaser listens on the window: typing a name must not walk the player
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameIn.blur();
    e.stopPropagation();
  });
  nameIn.addEventListener('change', () => set({ name: nameIn.value.trim() || randomPlayerName() }, true));

  set({});
  return { card, dialog, set: (s) => set(s) };
}
