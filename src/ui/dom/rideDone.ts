import './rideDone.css';
import type { RideSummary } from '../../sim/chain.ts';
import type { RouteLeg } from '../../core/network.ts';

/**
 * BETWEEN RIDES (sim/chain.ts): the world holds, and this is what is on
 * screen while it does. Two stages, both DOM over the canvas:
 *
 *   victory  the ride made, every factor of what it was worth, counted up,
 *            for as long as you care to look at it
 *   next     the ride to come, from, to, the route, and a button that
 *            starts it when YOU are ready
 *
 * It only reads the run. Starting the next ride is an input (CHOICE.go),
 * so the scene hands `onGo` to the sampler and the next tick carries it.
 * It used to be a Phaser card on a timer, made outside the HUD camera, so
 * the turning world camera drew it turned (from play 2026-09-26).
 */
export interface NextRide {
  ride: number;
  from: string;
  to: string;
  route: RouteLeg[];
  banked: number;
}

type Stage = 'victory' | 'next' | 'waiting';

/** keys pressed in the first moments are the ones that got you here */
const ARM_MS = 600;

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const n = (v: number) => Math.round(v).toLocaleString('sv-SE');

export class RideDoneScreen {
  private root: HTMLDivElement | null = null;
  stage: Stage | null = null;
  private shownAt = 0;
  private next: NextRide | null = null;
  private counting = 0;

  constructor(private readonly onGo: () => void) {}

  get visible(): boolean {
    return this.root !== null;
  }

  /** the ride was made: bask in it */
  victory(s: RideSummary, next: NextRide) {
    this.next = next;
    this.open('victory');
    const late = s.onTime < 1;
    const rows = s.wrong
      ? `<div class="tb-rd-row"><span>nothing banked</span><b>0</b></div>`
      : [
          ['takings in hand', `${n(s.inHand)} kr`],
          ['arrived', `× ${s.arrivalMul}`],
          [
            s.scheduleS > 0
              ? `${mmss(s.seconds)} against the timetable's ${mmss(s.scheduleS)}${late ? ', late' : ', on time'}`
              : `${mmss(s.seconds)}`,
            `× ${s.onTime.toFixed(2)}`,
          ],
          [s.ride > 1 ? `the chain, ride ${s.ride}` : 'the chain', `× ${s.chainMul}`],
        ]
          .map(([k, v]) => `<div class="tb-rd-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
          .join('');
    this.root!.innerHTML = `
      <div class="tb-rd-box ${s.wrong ? 'tb-rd-wrong' : ''}">
        <div class="tb-rd-kicker">${s.wrong ? 'WRONG STATION' : `RIDE ${s.ride} MADE`}</div>
        <div class="tb-rd-title">${esc(s.from)} <span>→</span> ${esc(s.to)}</div>
        <div class="tb-rd-sub">${s.stops} stop${s.stops === 1 ? '' : 's'} · ${mmss(s.seconds)}</div>
        <div class="tb-rd-rows">${rows}</div>
        <div class="tb-rd-worth"><span>${s.wrong ? 'banked' : 'banked this ride'}</span><b data-count="${s.worth}">0</b></div>
        <div class="tb-rd-pay">
          ${s.kr > 0 ? `<div><b>+${n(s.kr)} kr</b> to spend</div>` : ''}
          ${s.xp > 0 ? `<div><b>+${n(s.xp)} xp</b> for arriving</div>` : ''}
          <div>in the bank <b data-count="${s.banked}" data-from="${s.banked - s.worth}">${n(s.banked - s.worth)}</b></div>
        </div>
        <button class="tb-rd-btn" type="button">Continue</button>
        <div class="tb-rd-keys">E · Enter · Ⓐ</div>
      </div>`;
    this.root!.querySelector('button')!.addEventListener('click', () => this.advance(true));
    this.countUp();
  }

  /** the ride to come, and the button that starts it */
  showNext(next: NextRide) {
    this.next = next;
    this.open('next');
    const capital = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
    const route = next.route
      .map(
        (l, i) =>
          `<li><i style="background:${esc(l.service.color)}"></i>${i + 1}. ${esc(capital(l.service.color))} ${esc(String(l.service.id))} → ${esc(l.to)} <span>(${l.stops} stop${l.stops > 1 ? 's' : ''})</span></li>`,
      )
      .join('');
    const warn =
      next.ride >= 3
        ? 'the dark is inhumane from here'
        : next.ride === 2
          ? 'the dark is harder from here'
          : '';
    this.root!.classList.add('tb-rd-soft');
    this.root!.innerHTML = `
      <div class="tb-rd-box tb-rd-next">
        <div class="tb-rd-kicker">RIDE ${next.ride} · ${n(next.banked)} IN THE BANK</div>
        <div class="tb-rd-title">${esc(next.from)} <span>→</span> <em>${esc(next.to)}</em></div>
        <ol class="tb-rd-route">${route}</ol>
        ${warn ? `<div class="tb-rd-warn">${warn}</div>` : ''}
        <button class="tb-rd-btn tb-rd-go" type="button">Start ride ${next.ride}</button>
        <div class="tb-rd-keys">E · Enter · Ⓐ &nbsp;·&nbsp; TAB your cards</div>
      </div>`;
    this.root!.querySelector('button')!.addEventListener('click', () => this.advance(true));
  }

  /** E / Enter / A, from the scene: the same as the button on screen */
  advance(click = false) {
    if (!this.stage || (!click && performance.now() < this.shownAt + ARM_MS)) return;
    if (this.stage === 'victory') {
      if (this.next) this.showNext(this.next);
      return;
    }
    if (this.stage === 'next') {
      this.stage = 'waiting';
      const btn = this.root?.querySelector<HTMLButtonElement>('.tb-rd-go');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Waiting for the party…';
      }
      this.onGo();
    }
  }

  hide() {
    cancelAnimationFrame(this.counting);
    this.root?.remove();
    this.root = null;
    this.stage = null;
  }

  private open(stage: Stage) {
    cancelAnimationFrame(this.counting);
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'tb-ride-done';
      document.body.appendChild(this.root);
    }
    this.root.classList.remove('tb-rd-soft');
    this.stage = stage;
    this.shownAt = performance.now();
  }

  /** the numbers roll up to what they are: the reward, felt */
  private countUp() {
    const els = Array.from(this.root!.querySelectorAll<HTMLElement>('[data-count]'));
    const t0 = performance.now();
    const DUR = 1200;
    const frame = () => {
      const k = Math.min(1, (performance.now() - t0) / DUR);
      const e = 1 - Math.pow(1 - k, 3);
      for (const el of els) {
        const to = Number(el.dataset.count);
        const from = Number(el.dataset.from ?? 0);
        el.textContent = n(from + (to - from) * e);
      }
      if (k < 1) this.counting = requestAnimationFrame(frame);
    };
    this.counting = requestAnimationFrame(frame);
  }
}
