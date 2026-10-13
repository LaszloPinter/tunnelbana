import { el } from './menuBuild.ts';
import { LANE_INFO, type LaneId } from '../../core/lanes.ts';
import { PERKS } from '../../core/perks.ts';
import { TICKETS, withTickets } from '../../core/cards.ts';
import { rebuildMods, setLane } from '../../sim/modsRebuild.ts';
import { spawnEnemy } from '../../combat/enemies.ts';
import { spawnWave } from '../../combat/waves.ts';
import { aimDir, manaMax, maxHp } from '../../sim/player.ts';
import { onPlatform } from '../../world/floor.ts';
import type { EnemyKind } from '../../combat/types.ts';
import type { Run } from '../../sim/run.ts';
import * as C from '../../config.ts';

/**
 * THE LAB (dev only; `?lab` or the L key): every lane at every tier, in any
 * combination, without playing sixteen runs to see them. A DOM panel over
 * the game that rewrites the local seat, lanes, perks, tickets, the cast,
 * the level, the ride of the chain, and puts a horde in front of it. Every
 * change is a REBUILD of the seat's numbers from what it holds
 * (sim/modsRebuild.ts), never a patch, so what the lab shows is what a run
 * would deal. Solo only: it writes the sim outside a tick.
 */
export class Lab {
  private readonly root: HTMLElement;
  private readonly laneRows = new Map<LaneId, HTMLButtonElement[]>();
  private readonly status: HTMLElement;
  god = false;

  constructor(
    private readonly sim: () => Run,
    /** the debug tools above the lab: the run file, the instruments */
    tools: { label: string; run: () => string | void }[] = [],
    /** the lab rewrote the sim: this run is a dev run from here on */
    private readonly touched: () => void = () => {},
  ) {
    this.root = el('div', 'tb-lab');
    this.root.hidden = true;
    this.root.append(el('div', 'tb-lab-head', 'DEBUG <span>L to hide</span>'));
    this.status = el('div', 'tb-lab-status');
    this.root.append(this.status);
    const row = el('div', 'tb-lab-row');
    for (const t of tools) {
      const b = el('button', 'tb-lab-btn', t.label);
      b.onclick = () => {
        const said = t.run();
        if (said) this.say(said);
        b.blur();
      };
      row.append(b);
    }
    if (tools.length) this.root.append(row);
    // anything the lab changes is changed outside a tick
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button, select, input') && !row.contains(t)) this.touched();
    });
    this.root.append(
      el('div', 'tb-lab-title', 'LAB <span>(rewrites the run: it will not be saved or posted)</span>'),
    );

    // ---- lanes
    this.root.append(el('div', 'tb-lab-title', 'LANES'));
    for (const id of Object.keys(LANE_INFO) as LaneId[]) {
      const info = LANE_INFO[id];
      const row = el('div', 'tb-lab-row');
      row.append(el('span', 'tb-lab-name', info.title));
      const btns: HTMLButtonElement[] = [];
      for (const tier of [0, 1, 2]) {
        const b = el('button', 'tb-lab-btn', tier === 0 ? '-' : tier === 1 ? 'I' : 'II');
        b.onclick = () => {
          setLane(this.me, id, tier);
          this.say(`${info.title} ${tier === 0 ? 'off' : tier === 1 ? 'I' : 'II'}`);
          this.refresh();
          b.blur();
        };
        btns.push(b);
        row.append(b);
      }
      this.laneRows.set(id, btns);
      row.append(el('span', 'tb-lab-hint', info.t1));
      this.root.append(row);
    }

    // ---- the cast, the level, the ride
    const cast = el('div', 'tb-lab-row');
    cast.append(el('span', 'tb-lab-name', 'Cast'));
    for (const [label, weapon] of [
      ['Bolt', 'pistol'],
      ['Torrent', 'smg'],
    ] as const) {
      const b = el('button', 'tb-lab-btn', label);
      b.onclick = () => {
        this.me.weapon = weapon;
        this.refresh();
        b.blur();
      };
      cast.append(b);
    }
    this.root.append(cast);
    const lvl = el('div', 'tb-lab-row');
    lvl.append(el('span', 'tb-lab-name', 'Level'));
    for (const [label, n] of [
      ['1', 1],
      ['5', 5],
      ['12', 12],
      ['20', 20],
    ] as const) {
      const b = el('button', 'tb-lab-btn', label);
      b.onclick = () => {
        this.sim().party.level = n;
        this.refresh();
        b.blur();
      };
      lvl.append(b);
    }
    this.root.append(lvl);
    const ride = el('div', 'tb-lab-row');
    ride.append(el('span', 'tb-lab-name', 'Ride'));
    for (const n of [0, 1, 2, 3, 5]) {
      const b = el('button', 'tb-lab-btn', String(n + 1));
      b.onclick = () => {
        this.sim().ride = n;
        this.refresh();
        b.blur();
      };
      ride.append(b);
    }
    ride.append(el('span', 'tb-lab-hint', 'the chain: 1 casual · 2 difficult · 3+ inhumane'));
    this.root.append(ride);

    // ---- perks and tickets
    this.root.append(el('div', 'tb-lab-title', 'PERKS & TICKETS'));
    const perks = el('div', 'tb-lab-row');
    const perkSel = el('select', 'tb-lab-sel');
    for (const pk of PERKS) perkSel.append(new Option(pk.title, pk.id));
    const perkAdd = el('button', 'tb-lab-btn', '+ perk');
    perkAdd.onclick = () => {
      const me = this.me;
      me.perkCounts.set(perkSel.value, (me.perkCounts.get(perkSel.value) ?? 0) + 1);
      rebuildMods(me);
      this.refresh();
      perkAdd.blur();
    };
    const perkClear = el('button', 'tb-lab-btn', 'clear perks');
    perkClear.onclick = () => {
      this.me.perkCounts.clear();
      rebuildMods(this.me);
      this.refresh();
      perkClear.blur();
    };
    perks.append(perkSel, perkAdd, perkClear);
    this.root.append(perks);
    const tix = el('div', 'tb-lab-row');
    const tixSel = el('select', 'tb-lab-sel');
    for (const t of TICKETS) tixSel.append(new Option(`${t.title}: ${t.desc}`, t.id));
    const tixAdd = el('button', 'tb-lab-btn', '+ ticket');
    tixAdd.onclick = () => {
      const me = this.me;
      if (me.cardTier !== 'black') me.cardTier = 'yellow';
      withTickets(me, (ids) => {
        if (ids.length >= 3) ids.shift();
        ids.push(tixSel.value);
      });
      this.refresh();
      tixAdd.blur();
    };
    const tixClear = el('button', 'tb-lab-btn', 'clear card');
    tixClear.onclick = () => {
      withTickets(this.me, (ids) => ids.splice(0, ids.length));
      this.refresh();
      tixClear.blur();
    };
    tix.append(tixSel, tixAdd, tixClear);
    this.root.append(tix);

    // ---- the horde
    this.root.append(el('div', 'tb-lab-title', 'HORDE'));
    const horde = el('div', 'tb-lab-row');
    const kinds: [string, EnemyKind, number][] = [
      ['10 vättar', 'runner', 10],
      ['spitters', 'spitter', 4],
      ['troll', 'troll', 1],
      ['spider', 'spider', 1],
      ['daemon', 'daemon', 1],
      ['BERGAKUNGEN', 'boss', 1],
    ];
    for (const [label, kind, n] of kinds) {
      const b = el('button', 'tb-lab-btn', label);
      b.onclick = () => {
        this.spawn(kind, n);
        b.blur();
      };
      horde.append(b);
    }
    this.root.append(horde);
    const horde2 = el('div', 'tb-lab-row');
    const elite = el('button', 'tb-lab-btn', 'elite + 6 behind');
    elite.onclick = () => {
      this.spawnElite();
      elite.blur();
    };
    const wave = el('button', 'tb-lab-btn', 'a wave');
    wave.onclick = () => {
      const sim = this.sim();
      spawnWave(sim.hereHost, sim.gameNow);
      wave.blur();
    };
    const clear = el('button', 'tb-lab-btn', 'clear horde');
    clear.onclick = () => {
      for (const pl of this.sim().places.values()) pl.enemies.length = 0;
      clear.blur();
    };
    const godBtn = el('button', 'tb-lab-btn', 'god mode');
    godBtn.onclick = () => {
      this.god = !this.god;
      godBtn.classList.toggle('is-on', this.god);
      godBtn.blur();
    };
    horde2.append(elite, wave, clear, godBtn);
    this.root.append(horde2);

    document.body.appendChild(this.root);
  }

  private get me() {
    return this.sim().me;
  }

  private say(text: string) {
    this.status.textContent = text;
  }

  /** every frame while shown: god mode, and the readout */
  tick() {
    if (this.root.hidden) return;
    if (this.god) {
      const me = this.me;
      const sim = this.sim();
      me.health = maxHp(me);
      me.mana = manaMax(sim.party, me);
      me.iframesUntil = sim.gameNow + 1000;
    }
  }

  private refresh() {
    const me = this.me;
    for (const [id, btns] of this.laneRows)
      btns.forEach((b, i) => b.classList.toggle('is-on', me.lanes[id] === i));
    const m = me.mods;
    this.say(
      `${me.weapon === 'smg' ? 'torrent' : 'bolt'} · lvl ${this.sim().party.level} · ride ${this.sim().ride + 1} · ` +
        `chain ${m.chain} · homing ${m.homing} · pierce ${m.pierce} · laddning ${m.laddning} · ram 1/${m.ramEvery || '-'} · ` +
        `dmg +${m.bulletDamage} ×${m.boltMul.toFixed(2)} · card [${me.cards.join(', ')}]`,
    );
  }

  private spawn(kind: EnemyKind, n: number) {
    const sim = this.sim();
    const me = sim.me;
    const host = sim.hereHost;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const r = C.M(kind === 'boss' ? 9 : 6 + (i % 3));
      // spawnEnemy names a point in the place's own terms; on the map the
      // seat's own position is already a map point, so hand it a spot
      // beside the seat through the place's frame
      const pt =
        sim.here.kind === 'station' ? toLocal(sim, me.x + Math.cos(a) * r, me.y + Math.sin(a) * r) : null;
      if (!pt) continue;
      spawnEnemy(host, kind, { kind: 'world' }, pt.x, pt.y, true);
    }
  }

  private spawnElite() {
    const sim = this.sim();
    const me = sim.me;
    const host = sim.hereHost;
    const aim = aimDir(me);
    const dx = aim.x;
    const dy = aim.y;
    const front = toLocal(sim, me.x + dx * C.M(6), me.y + dy * C.M(6));
    if (!front) return;
    const e = spawnEnemy(
      host,
      'runner',
      { kind: 'world' },
      front.x,
      front.y,
      true,
      0,
      1,
      1,
      () => 0.5,
      'elite',
    );
    e.ward = { hp: C.WARD_HP, max: C.WARD_HP, angle: 0 };
    for (let i = 0; i < 6; i++) {
      const p = toLocal(
        sim,
        me.x + dx * C.M(8 + i * 0.9) + dy * C.M((i % 3) - 1),
        me.y + dy * C.M(8 + i * 0.9) - dx * C.M((i % 3) - 1),
      );
      if (p) spawnEnemy(host, 'runner', { kind: 'world' }, p.x, p.y, true);
    }
  }

  toggle() {
    this.root.hidden = !this.root.hidden;
    if (!this.root.hidden) this.refresh();
  }

  get visible() {
    return !this.root.hidden;
  }
}

/** a map point said in the station's own along-and-across (world/floor.ts) */
function toLocal(sim: Run, x: number, y: number): { x: number; y: number } | null {
  const st = sim.hereStation;
  return st ? onPlatform(st, x, y) : null;
}
