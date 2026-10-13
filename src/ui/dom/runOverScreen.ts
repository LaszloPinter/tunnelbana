import './rideDone.css';
import './runOverScreen.css';
import { drawLook, type PlayerLook } from '../../render/look.ts';

/**
 * THE END OF A RUN, as a page over the canvas: your commuter and your name,
 * how it ended, the score counted up with the rides that made it, the
 * numbers of the run, whether it went on the board, and two ways on: again,
 * or back to the landing. Only reads what it is given (scenes/runOver.ts
 * decides everything); Enter / Space / A is "again", Esc the landing.
 */
export interface RunOverView {
  kind: 'win' | 'extract' | 'died';
  reason: string;
  name: string;
  look: PlayerLook;
  score: number;
  banked: number;
  rides: { from: string; to: string; worth: number }[];
  ride: number;
  stops: number;
  kills: number;
  kr: number;
  level: number;
  seconds: number;
  crowns: number;
  /** the timetable line for the ride in progress, or '' */
  clockLine: string;
  /** posted to the day's board */
  ranked: boolean;
  daily: string | null;
  onAgain(): void;
  onLanding(): void;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n = (v: number) => Math.round(v).toLocaleString('sv-SE');
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** keys pressed in the moment of dying are not a choice */
const ARM_MS = 900;

export function showRunOverScreen(v: RunOverView): { remove(): void } {
  const root = document.createElement('div');
  root.id = 'tb-ride-done';
  root.className = 'tb-ro';
  const made = v.ride > 0;
  const kicker =
    v.kind === 'died'
      ? made
        ? `DOWN ON RIDE ${v.ride + 1}: ${v.ride} MADE`
        : 'DOWN BEFORE THE FIRST ARRIVAL'
      : v.kind === 'extract'
        ? `CASHED OUT: ${v.ride} RIDE${v.ride === 1 ? '' : 'S'} MADE`
        : 'YOU MADE IT';
  const verdict =
    v.kind === 'died'
      ? made
        ? `What was in hand is lost; ${v.ride === 1 ? 'the ride you banked stands' : `the ${v.ride} rides you banked stand`}.`
        : 'Nothing was banked: make the first arrival and it can never be taken from you.'
      : v.kind === 'extract'
        ? 'You walked out with what you had.'
        : 'Arrived.';
  const rides = v.rides
    .map(
      (r, i) =>
        `<div class="tb-rd-row"><span>${i + 1}. ${esc(r.from)} → ${esc(r.to)}</span><b>${r.worth > 0 ? `+${n(r.worth)}` : '0'}</b></div>`,
    )
    .join('');
  const stat = (k: string, val: string) => `<div class="tb-ro-stat"><b>${val}</b><span>${k}</span></div>`;
  root.innerHTML = `
    <div class="tb-rd-box tb-ro-box ${v.kind === 'died' && !made ? 'tb-rd-wrong' : ''}">
      <div class="tb-ro-who">
        <canvas width="112" height="112" aria-hidden="true"></canvas>
        <div>
          <div class="tb-rd-kicker">${kicker}</div>
          <div class="tb-ro-name">${esc(v.name)}</div>
          <div class="tb-rd-sub">${esc(v.kind === 'died' ? v.reason : verdict)}</div>
        </div>
      </div>
      ${v.kind === 'died' ? `<p class="tb-ro-verdict">${esc(verdict)}</p>` : ''}
      <div class="tb-rd-worth"><span>score</span><b data-count="${v.score}">0</b></div>
      ${rides ? `<div class="tb-rd-rows">${rides}</div>` : ''}
      <div class="tb-ro-stats">
        ${stat('stops', n(v.stops))}${stat('kills', n(v.kills))}${stat('kr', n(v.kr))}${stat('level', String(v.level))}${stat('time', mmss(v.seconds))}${v.crowns > 0 ? stat('Bergakungen', `👑${v.crowns > 1 ? ` ×${v.crowns}` : ''}`) : ''}
      </div>
      ${v.clockLine ? `<div class="tb-rd-sub">${esc(v.clockLine)}</div>` : ''}
      <div class="tb-ro-board">${
        v.ranked
          ? `On today's board (${esc(v.daily ?? '')}) as <b>${esc(v.name)}</b>.`
          : 'Quick play is unranked: the <b>daily</b> is the same ride for everyone, and it goes on the board.'
      }</div>
      <div class="tb-ro-actions">
        <button class="tb-rd-btn" type="button" data-act="landing">Landing</button>
        <button class="tb-rd-btn tb-rd-go" type="button" data-act="again">New run ▸</button>
      </div>
      <div class="tb-rd-keys">Enter · Ⓐ new run &nbsp;·&nbsp; Esc landing</div>
    </div>`;
  document.body.appendChild(root);

  const cv = root.querySelector('canvas')!;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  cv.width = 112 * dpr;
  cv.height = 112 * dpr;
  cv.style.width = '112px';
  cv.style.height = '112px';
  const ctx = cv.getContext('2d');
  if (ctx) drawLook(ctx, v.look, cv.width / 2, cv.height / 2 + 4 * dpr, cv.width / 1.75);

  const shownAt = performance.now();
  let gone = false;
  const act = (what: 'again' | 'landing', click: boolean) => {
    if (gone || (!click && performance.now() < shownAt + ARM_MS)) return;
    if (what === 'again') v.onAgain();
    else v.onLanding();
  };
  root.querySelector('[data-act="again"]')!.addEventListener('click', () => act('again', true));
  root.querySelector('[data-act="landing"]')!.addEventListener('click', () => act('landing', true));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') act('again', false);
  };
  window.addEventListener('keydown', onKey);
  // a pad: A is again, B the landing
  let raf = 0;
  const pads = () => {
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (pad?.buttons[0]?.pressed) act('again', false);
      else if (pad?.buttons[1]?.pressed) act('landing', false);
    }
    raf = requestAnimationFrame(pads);
  };
  raf = requestAnimationFrame(pads);

  // the score rolls up to what it is
  const el = root.querySelector<HTMLElement>('[data-count]')!;
  const t0 = performance.now();
  let count = 0;
  const roll = () => {
    const k = Math.min(1, (performance.now() - t0) / 1400);
    el.textContent = n(v.score * (1 - Math.pow(1 - k, 3)));
    if (k < 1) count = requestAnimationFrame(roll);
  };
  count = requestAnimationFrame(roll);

  return {
    remove() {
      gone = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(count);
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
