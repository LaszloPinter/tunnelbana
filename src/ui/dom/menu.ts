import './menu.css';
import { makeRng } from '../../sim/det.ts';
import { MAX_STOPS, MIN_STOPS, pickJourney, type Journey } from '../../core/network.ts';
import { buildMenu, el, type MenuParts } from './menuBuild.ts';
import type { PlayerLook } from '../../render/look.ts';

/**
 * THE LANDING, AS A DEPARTURE BOARD.
 *
 * Quick play already IS a journey, an origin, a destination and a change of
 * line in between, so the menu is the board that would announce it. Re-roll
 * flips the board; the seed is the train number underneath.
 *
 * It is DOM over the canvas rather than drawn in Phaser. The seed field and
 * the player's name are the reason: inside a canvas each needs a hand-rolled
 * keyboard handler, cannot be selected or focused, and is invisible to a
 * screen reader. Outside one they are just inputs.
 */

export interface MenuCallbacks {
  /** play this seed; the journey shown is derived from it */
  onPlay(seed: number): void;
  /** the day's run, one attempt, the same for everybody */
  onDaily(seed: number, date: string): void;
  /** the player renamed themselves */
  onName(name: string): void;
  /** ...or changed how they look */
  onLook(look: PlayerLook): void;
  onLeaderboard(): void;
  /** pick the run in progress back up */
  onContinue(): void;
  /** throw the saved run away */
  onDiscard(): void;
  /** play the tutorial again, from Controls */
  onTutorial(): void;
}

export interface MenuState {
  /**
   * Linked to a real credential rather than only anonymous. Nothing offers to
   * link one yet, see the card in build(), but account.ts can already do it
   * and the card is ready to say so the day it is switched on.
   */
  linked: boolean;
  name: string;
  look: PlayerLook;
  /** what this player has done today, if anything */
  dailyDone?: { stops: number; won: boolean };
  /** today's top three on the board; undefined until it has been asked */
  dailyTop?: BoardLine[];
  /** the run in progress, if one is saved (src/save.ts SavedRun) */
  saved?: {
    ride: number;
    station: string;
    dest: string;
    seconds: number;
    daily: string | null;
    /** saved by another build of the game: its replay cannot be trusted */
    stale: boolean;
  } | null;
  version: string;
  build: string;
  /** a real run has been started before: the Play button need not pulse */
  playedOnce: boolean;
}

export interface BoardLine {
  name: string;
  score: number;
  stops: number;
  /** this browser's own row */
  mine?: boolean;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const LINE_COLOUR: Record<string, string> = { green: 'green', red: 'red', blue: 'blue' };

/** the day's run: a seed hashed from the UTC date, agreed by arithmetic */
export function dailySeed(now = new Date()): { seed: number; date: string } {
  const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { seed: h >>> 0, date };
}

/** the journey a seed deals, without starting anything */
export const journeyOf = (seed: number): Journey => pickJourney(makeRng(seed >>> 0));

export class Menu {
  readonly root: HTMLDivElement;
  private seed: number;
  private state: MenuState;
  private cb: MenuCallbacks;
  private q: MenuParts;

  constructor(cb: MenuCallbacks, state: MenuState) {
    this.cb = cb;
    this.state = state;
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.root = document.createElement('div');
    this.root.id = 'tb-menu';
    this.q = buildMenu(this.root, this.state, {
      onReroll: () => {
        this.seed = (Math.random() * 0xffffffff) >>> 0;
        this.render(true);
      },
      onPlay: () => this.cb.onPlay(this.seed),
      onSeed: (v) => {
        if (Number.isFinite(v)) this.seed = v >>> 0;
        this.render(true);
      },
      onName: (n) => {
        this.state.name = n;
        this.cb.onName(n);
      },
      onLook: (l) => {
        this.state.look = l;
        this.cb.onLook(l);
      },
      onDaily: () => {
        const d = dailySeed();
        this.cb.onDaily(d.seed, d.date);
      },
      onLeaderboard: () => this.cb.onLeaderboard(),
      onContinue: () => this.cb.onContinue(),
      onDiscard: () => this.cb.onDiscard(),
      onTutorial: () => this.cb.onTutorial(),
    });
    document.body.appendChild(this.root);
    this.render(false);
  }

  /** paint everything that depends on the seed or the player */
  private render(animate: boolean) {
    const j = journeyOf(this.seed);
    this.q.from.textContent = j.from;
    this.q.to.textContent = j.to;
    this.q.seed.value = String(this.seed >>> 0);

    const first = j.legs[0];
    const last = j.legs[j.legs.length - 1];
    this.q.badge.className = `tb-badge ${LINE_COLOUR[first.service.color] ?? ''}`;
    this.q.badge.textContent = first.service.id;
    const via = first.to;
    this.q.meta.innerHTML =
      `Quick play, unranked · <b>${j.stops} stops</b> · ${first.service.color} ${first.service.id} ` +
      `→ ${last.service.color} ${last.service.id} · change at <b>${via}</b>`;

    if (animate) {
      this.q.journey.classList.remove('tb-flip');
      void this.q.journey.offsetWidth;
      this.q.journey.classList.add('tb-flip');
    }

    // the day's run
    const d = dailySeed();
    const dj = journeyOf(d.seed);
    this.q.dailyJourney.innerHTML = '';
    this.q.dailyJourney.append(
      el('span', undefined, dj.from),
      el('span', 'tb-arrow', '→'),
      el('span', undefined, dj.to),
    );
    const done = this.state.dailyDone;
    this.q.dailyMeta.innerHTML =
      `Daily challenge · ${d.date} · <b>${dj.stops} stops</b> to the first arrival, then the chain · the same ride for everyone, ranked` +
      (done ? ` · you: <b>${done.stops} stops</b>${done.won ? ' (arrived)' : ''}` : '');
    // TODAY'S TOP THREE, right under the ride they played: the reason to try it
    const top = this.state.dailyTop;
    this.q.dailyTop.innerHTML =
      top === undefined
        ? ''
        : top.length === 0
          ? `<span class="tb-top3-empty">Nobody has ridden today's yet: the top spot is yours to take.</span>`
          : `<span class="tb-top3-head">TODAY'S TOP ${top.length}</span>` +
            top
              .map(
                (r, i) =>
                  `<span class="tb-top3-row"><i>${['🥇', '🥈', '🥉'][i] ?? i + 1}</i><b>${esc(r.name)}</b> ${r.score.toLocaleString('sv-SE')}</span>`,
              )
              .join('');

    // the run in progress
    const sv = this.state.saved;
    this.q.cont.style.display = sv ? '' : 'none';
    if (sv) {
      this.q.contJourney.innerHTML = '';
      this.q.contJourney.append(
        el('span', undefined, sv.station),
        el('span', 'tb-arrow', '→'),
        el('span', undefined, sv.dest),
      );
      const m = Math.round(sv.seconds / 60);
      this.q.contMeta.innerHTML = sv.stale
        ? `Saved by an <b>older build</b> · <b>ride ${sv.ride + 1}</b> · ${m} min in · it cannot be continued after an update, so discard it`
        : `Continue · <b>ride ${sv.ride + 1}</b> · ${m} min in${sv.daily ? ` · the daily of ${sv.daily}` : ''} · starting another run replaces it`;
      this.q.contPlay.disabled = sv.stale;
      this.q.contPlay.style.opacity = sv.stale ? '0.35' : '';
    }

    // a first visit: the way in is the one thing on the page that moves
    this.q.play.classList.toggle('tb-pulse', !this.state.playedOnce);
    // ONE LIT BUTTON: with a run to continue, Quick play steps back to an outline
    const resuming = this.q.cont.style.display !== 'none';
    this.q.play.classList.toggle('tb-btn-go', !resuming);
    this.q.play.classList.toggle('tb-btn-amber', resuming);
    this.paintCard();
  }

  private paintCard() {
    this.q.avatar.set({ name: this.state.name, look: this.state.look });
  }

  /** the account changed under us, anonymous became linked, or signed out */
  setState(patch: Partial<MenuState>) {
    this.state = { ...this.state, ...patch };
    this.render(false);
  }

  /** the Leaderboard dialog: today's daily, ranked (null while it loads) */
  showBoard(date: string, rows: BoardLine[] | null | 'offline') {
    let dlg = this.root.querySelector<HTMLDialogElement>('#tb-board');
    if (!dlg) {
      dlg = el('dialog');
      dlg.id = 'tb-board';
      this.root.appendChild(dlg);
    }
    const body =
      rows === null
        ? '<p class="tb-board-note">Reading the board…</p>'
        : rows === 'offline'
          ? '<p class="tb-board-note">The board cannot be reached right now. Try again in a moment.</p>'
          : rows.length === 0
            ? '<p class="tb-board-note">No runs on the board today yet. Play the daily and yours is the first.</p>'
            : `<ol class="tb-board-list">${rows
                .map(
                  (r, i) =>
                    `<li class="${r.mine ? 'is-mine' : ''}"><span class="tb-board-rank">${i + 1}</span><span class="tb-board-name">${esc(r.name)}${r.mine ? ' <em>you</em>' : ''}</span><span class="tb-board-stops">${r.stops} stops</span><span class="tb-board-score">${r.score.toLocaleString('sv-SE')}</span></li>`,
                )
                .join('')}</ol>`;
    dlg.innerHTML = `<div class="tb-panel-head"><h2>Daily · ${esc(date)}</h2><button class="tb-btn" type="button">Close</button></div><div class="tb-panel-body">${body}</div>`;
    const d = dlg;
    dlg.querySelector('button')!.addEventListener('click', () => d.close());
    if (!dlg.open) dlg.showModal();
  }

  show() {
    this.root.hidden = false;
    this.render(false);
    this.padIndex = -1;
  }

  // ---- a pad on the landing: the buttons in reading order, one lit ----
  private padIndex = -1;

  /** every button a pad may land on right now: inside an open dialog, or on the page */
  private padTargets(): HTMLElement[] {
    const dlg = this.root.querySelector('dialog[open]');
    const scope: ParentNode = dlg ?? this.root;
    const all = Array.from(scope.querySelectorAll<HTMLElement>('button'));
    return all.filter((b) => {
      if ((b as HTMLButtonElement).disabled) return false;
      if (!dlg && b.closest('dialog')) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  private padPaint(targets: HTMLElement[]) {
    for (const b of Array.from(this.root.querySelectorAll('.tb-pad-focus')))
      b.classList.remove('tb-pad-focus');
    const t = targets[this.padIndex];
    if (t) {
      t.classList.add('tb-pad-focus');
      t.focus({ preventScroll: false });
    }
  }

  /** the D-pad: the next or the previous button; the first press lands on Play */
  padStep(delta: 1 | -1) {
    const targets = this.padTargets();
    if (targets.length === 0) return;
    if (this.padIndex < 0) {
      const play = targets.indexOf(this.q.play);
      this.padIndex = play >= 0 ? play : 0;
    } else this.padIndex = (this.padIndex + delta + targets.length) % targets.length;
    this.padPaint(targets);
  }

  /** A: press what is lit; with nothing lit yet, Play */
  padActivate() {
    const targets = this.padTargets();
    if (this.padIndex < 0) this.padStep(1);
    const t = this.padTargets()[this.padIndex] ?? targets[0];
    t?.click();
    // a dialog just opened or closed: the lit button is on the other page
    this.padIndex = -1;
    this.padPaint([]);
  }

  /** B: close an open dialog */
  padBack() {
    const dlg = this.root.querySelector<HTMLDialogElement>('dialog[open]');
    if (dlg) {
      dlg.close();
      this.padIndex = -1;
      this.padPaint([]);
    }
  }

  hide() {
    this.root.hidden = true;
  }

  get visible() {
    return !this.root.hidden;
  }
}

export { MIN_STOPS, MAX_STOPS };
