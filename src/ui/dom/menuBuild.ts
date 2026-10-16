import type { MenuState } from './menu.ts';
import { aboutPanel, controlsPanel } from './menuPanels.ts';
import { buildAvatar, type AvatarParts } from './avatar.ts';
import type { PlayerLook } from '../../render/look.ts';
import { buildTea } from './tea.ts';

/** what the board's controls do, the Menu owns the seed and the callbacks */
export interface MenuHandlers {
  onReroll(): void;
  onPlay(): void;
  /** a seed typed into the field (NaN when it was not a number) */
  onSeed(seed: number): void;
  onName(name: string): void;
  onLook(look: PlayerLook): void;
  onDaily(): void;
  onLeaderboard(): void;
  onContinue(): void;
  onDiscard(): void;
  onTutorial(): void;
}

/** the elements the Menu repaints */
export interface MenuParts {
  play: HTMLButtonElement;
  badge: HTMLElement;
  journey: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  meta: HTMLElement;
  seed: HTMLInputElement;
  avatar: AvatarParts;
  dailyJourney: HTMLElement;
  dailyMeta: HTMLElement;
  /** today's top three, under the daily */
  dailyTop: HTMLElement;
  /** the run in progress, shown only while there is one */
  cont: HTMLElement;
  contJourney: HTMLElement;
  contMeta: HTMLElement;
  contPlay: HTMLButtonElement;
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/**
 * The typefaces, injected rather than written into index.html, that file is
 * the author's, and a stylesheet link is the app's business. Archivo carries
 * the wordmark (a signage grotesque with a width axis, so TUNNELBANA can be
 * set wide like a station sign), Barlow the interface, IBM Plex Mono the board
 * and the seed. SL's own SL Gothic is commissioned and not licensable.
 */
export function loadFonts() {
  if (document.getElementById('tb-fonts')) return;
  const link = el('link');
  link.id = 'tb-fonts';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(link);
}

/** THE BOARD, built once: the masthead and travelcard, the two departures,
 * the further departures, the notice and the foot */
export function buildMenu(root: HTMLDivElement, state: MenuState, on: MenuHandlers): MenuParts {
  loadFonts();
  const lines = el('div', 'tb-lines');
  for (const c of ['--tb-green', '--tb-red', '--tb-blue']) {
    const i = el('i');
    i.style.background = `var(${c})`;
    lines.appendChild(i);
  }

  const frame = el('div', 'tb-frame');

  // ---- masthead and travelcard ----
  const head = el('div', 'tb-head');
  const title = el('div');
  title.appendChild(el('h1', 'tb-wordmark', 'TUNNELBANA'));
  title.appendChild(el('p', 'tb-tagline', 'Get where you are going'));
  // WHAT THIS IS, in one line: the page never said (alpha UX pass, 2026-09-30)
  title.appendChild(
    el(
      'p',
      'tb-pitch',
      'A top-down action roguelite in the real Stockholm metro. Ride the trains, hold off the horde on every platform, get off at your stop, then ride on, deeper and darker.',
    ),
  );

  // No sign-in button. Everybody is signed in anonymously already and every
  // daily score is on the board; a Google account would only add recovering
  // it on another device, which is not worth a consent screen in an alpha.
  // The card is simply who you are: your commuter, and your name.
  const avatar = buildAvatar({ name: state.name, look: state.look }, { name: on.onName, look: on.onLook });
  head.append(title, avatar.card);

  // ---- the board ----
  const board = el('main', 'tb-board');
  // A DEPARTURE BOARD HAS A CLOCK: Stockholm time, ticking, so the page is
  // alive before anything is touched (alpha polish, 2026-10-12)
  const boardHead = el('div', 'tb-board-head');
  const clock = el('span', 'tb-clock');
  boardHead.append(el('span', 'tb-board-title', '<i></i>AVGÅNGAR · DEPARTURES'), clock);
  const tick = () => {
    if (root.hidden) return;
    const t = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date());
    clock.textContent = t;
  };
  tick();
  setInterval(tick, 1000);

  const qRow = el('div', 'tb-row');
  const qBadge = el('div', 'tb-badge');
  const qMid = el('div');
  const journey = el('div', 'tb-journey');
  const from = el('span');
  const arrow = el('span', 'tb-arrow', '→');
  const to = el('span');
  journey.append(from, arrow, to);
  const meta = el('div', 'tb-meta');
  const seedWrap = el('div', 'tb-seed');
  const seedLabel = el('label', undefined, 'SEED');
  seedLabel.htmlFor = 'tb-seed-input';
  const seedInput = el('input');
  seedInput.id = 'tb-seed-input';
  seedInput.inputMode = 'numeric';
  seedInput.spellcheck = false;
  seedWrap.append(seedLabel, seedInput, el('span', 'tb-hint', 'paste one to play it again'));
  qMid.append(journey, meta, seedWrap);
  const qActions = el('div', 'tb-actions');
  const reroll = el('button', 'tb-btn', '↻ Re-roll');
  const play = el('button', 'tb-btn tb-btn-go', 'Play ▸');
  qActions.append(reroll, play);
  qRow.append(qBadge, qMid, qActions);

  const dRow = el('div', 'tb-row tb-daily');
  const dBadge = el('div', 'tb-badge red', 'DAG');
  const dMid = el('div');
  const dJourney = el('div', 'tb-journey');
  const dMeta = el('div', 'tb-meta');
  const dTop = el('div', 'tb-top3');
  dMid.append(dJourney, dMeta, dTop);
  const dActions = el('div', 'tb-actions');
  const dPlay = el('button', 'tb-btn tb-btn-amber', 'Play ▸');
  dActions.append(dPlay);
  dRow.append(dBadge, dMid, dActions);

  // ---- the run in progress ----
  const cRow = el('div', 'tb-row tb-continue');
  // not `hidden`: .tb-row sets display, which beats the attribute
  cRow.style.display = 'none';
  const cBadge = el('div', 'tb-badge green', '▶');
  const cMid = el('div');
  const cJourney = el('div', 'tb-journey');
  const cMeta = el('div', 'tb-meta');
  cMid.append(cJourney, cMeta);
  const cActions = el('div', 'tb-actions');
  const cPlay = el('button', 'tb-btn tb-btn-go', 'Continue ▸');
  const cDrop = el('button', 'tb-btn', '✕ Discard');
  cActions.append(cDrop, cPlay);
  cRow.append(cBadge, cMid, cActions);

  board.append(boardHead, cRow, qRow, dRow, buildTea());

  // ---- further departures ----
  const more = el('nav', 'tb-more');
  const mk = (t: string, s: string) => {
    const b = el('button');
    b.append(el('span', 'tb-t', t), el('span', 'tb-s', s));
    return b;
  };
  const lb = mk('Leaderboard', "Today's daily, ranked");
  const ctrl = mk('Controls', 'Keyboard and mouse, or a pad');
  const about = mk('About', 'What this is, and why');
  more.append(lb, ctrl, about);

  const notice = el('div', 'tb-notice');
  // A PHONE OR A TABLET cannot play this: no keys, no cursor. Said up front,
  // where the Play button is, rather than found out on the platform
  const touchOnly =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches === true;
  notice.append(
    el('span', 'tb-tag', 'TRAFIKINFORMATION'),
    el(
      'p',
      undefined,
      touchOnly
        ? 'On a phone: turn it sideways. Your left thumb walks, the buttons dash and STÖT, and casting is automatic. Free: no ads, no purchases. Alpha: no sound yet.'
        : 'Free: no ads, no purchases, ever. The kronor are the game’s own money. Alpha: no sound yet, single player.',
    ),
  );

  const foot = el('div', 'tb-foot');
  foot.append(
    el('span', undefined, `TUNNELBANA ${state.version} · ALPHA · ${state.build}`),
    el('span', undefined, 'Map data © OpenStreetMap contributors, ODbL'),
  );

  // a phone is told before anything else, not under the fold
  if (touchOnly) frame.append(head, notice, board, more, foot);
  else frame.append(head, board, more, notice, foot);
  root.append(lines, frame, controlsPanel(), aboutPanel(), avatar.dialog);

  // ---- wiring ----
  reroll.addEventListener('click', on.onReroll);
  play.addEventListener('click', on.onPlay);
  seedInput.addEventListener('change', () => on.onSeed(parseInt(seedInput.value.replace(/\D/g, ''), 10)));
  seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') seedInput.blur();
    e.stopPropagation();
  });
  dPlay.addEventListener('click', on.onDaily);
  cPlay.addEventListener('click', on.onContinue);
  cDrop.addEventListener('click', on.onDiscard);
  lb.addEventListener('click', on.onLeaderboard);
  ctrl.addEventListener('click', () => (root.querySelector('#tb-controls') as HTMLDialogElement).showModal());
  about.addEventListener('click', () => (root.querySelector('#tb-about') as HTMLDialogElement).showModal());
  // ENTER PLAYS: the lit button, Continue when there is a run to go back
  // to, else Quick play, unless a field or a button has the key already
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || root.hidden || root.querySelector('dialog[open]')) return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== root && root.contains(a)) return;
    e.preventDefault();
    (cRow.style.display === 'none' ? play : cPlay).click();
  });
  // ESC CLOSES A DIALOG. The browser does that itself, unless the game has
  // captured the key on the window, which Phaser does for every key it binds
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = root.querySelector<HTMLDialogElement>('dialog[open]');
    if (open) {
      e.preventDefault();
      open.close();
    }
  });

  return {
    contPlay: cPlay,
    play,
    badge: qBadge,
    journey,
    from,
    to,
    meta,
    seed: seedInput,
    avatar,
    dailyJourney: dJourney,
    dailyMeta: dMeta,
    dailyTop: dTop,
    cont: cRow,
    contJourney: cJourney,
    contMeta: cMeta,
  };
}
