import Phaser from 'phaser';
import * as C from '../config.ts';
import { shownName } from '../core/network.ts';
import { nearFixture } from '../world/fixtures.ts';
import { shortName, type RouteLeg } from '../core/network.ts';
import { levelOfService, stationPlan } from '../data/platformPlan.ts';
import type { Run } from '../sim/run.ts';
import { asStation } from '../sim/place.ts';
import { atVendor } from '../sim/legWalk.ts';
import { askerNear } from '../combat/paxTalk.ts';
import { dealerNear } from '../combat/langaren.ts';
import { nearExit, shaftAt } from '../sim/ground.ts';
import { setTextColor } from '../render/text.ts';
import { drawBossBar, drawVitals, pausePanel } from './hudBars.ts';
import { loadFonts } from '../ui/dom/menuBuild.ts';
import { DATA_FONT, HudStatus, STRIP_H, UI_FONT } from './hudStatus.ts';

/** what the scene must do while HUD objects are being made */
export interface HudScene extends Phaser.Scene {
  uiMode: boolean;
}

/** the frame's facts the HUD needs beyond the sim */
export interface HudFrame {
  paused: boolean;
  runOver: boolean;
  startScreen: boolean;
  /** the run's opening shot, nought to one; 1 once it is over */
  opening: number;
}

/**
 * THE HUD: the departure board, the direction hint, the vitals, the status
 * line, the boss bar, the banner and the message line, everything on the
 * fixed camera that describes the run. It reads the sim and writes text;
 * nothing here decides anything.
 */
export class Hud {
  private boardText!: Phaser.GameObjects.Text;
  /** the board's panel, as wide as its widest line */
  private boardBack!: Phaser.GameObjects.Rectangle;
  private dirHint!: Phaser.GameObjects.Text;
  private vitals!: Phaser.GameObjects.Graphics;
  private hpLabel!: Phaser.GameObjects.Text;
  private manaLabel!: Phaser.GameObjects.Text;
  private hurtVignette!: Phaser.GameObjects.Rectangle;
  private status!: HudStatus;
  private msgText!: Phaser.GameObjects.Text;
  private bossBar!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private openingText!: Phaser.GameObjects.Text;
  private openingSub!: Phaser.GameObjects.Text;
  private pausedText!: Phaser.GameObjects.Text;
  private msgUntil = 0;
  /** the tutorial: everything but the messages steps back */
  muted = false;

  constructor(private readonly scene: HudScene) {
    const s = scene;
    s.uiMode = true;
    const mono = (size: number, color: string, extra: Record<string, unknown> = {}) => ({
      fontFamily: 'monospace',
      fontSize: `${size}px`,
      color,
      ...extra,
    });
    this.boardBack = s.add
      .rectangle(10, 10, 430, 112, 0x14141c)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(99)
      .setAlpha(0.92);
    this.boardText = s.add
      .text(22, 18, '', mono(14, '#ffcf5c', { lineSpacing: 2 }))
      .setScrollFactor(0)
      .setDepth(100);
    this.dirHint = s.add
      .text(22, 86, '', mono(15, '#8ef0a8', { fontStyle: 'bold' }))
      .setScrollFactor(0)
      .setDepth(101);
    this.vitals = s.add.graphics().setScrollFactor(0).setDepth(101);
    this.status = new HudStatus(s);
    // THE HUD'S TYPEFACES are web fonts: asked for now, and the text drawn
    // again once they are here (a canvas text keeps the font it was first
    // rasterised in)
    loadFonts();
    void Promise.all([
      document.fonts?.load("700 20px 'Barlow'"),
      document.fonts?.load("10px 'IBM Plex Mono'"),
    ])
      .then(() => this.refreshFonts())
      .catch(() => {});
    this.hpLabel = s.add
      .text(30, C.GAME_HEIGHT - 62, '', {
        fontFamily: DATA_FONT,
        fontSize: '12px',
        color: '#ffe8e8',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(102);
    this.manaLabel = s.add
      .text(30, C.GAME_HEIGHT - 36, '', {
        fontFamily: DATA_FONT,
        fontSize: '12px',
        color: '#e8e0ff',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(102);
    this.hurtVignette = s.add
      .rectangle(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2, C.GAME_WIDTH, C.GAME_HEIGHT, 0xff2020)
      .setScrollFactor(0)
      .setDepth(98)
      .setAlpha(0);
    // THE MESSAGE LINE, a pill above the strip: what just happened in ink,
    // what you can DO right here (the context hints) in amber
    this.msgText = s.add
      .text(C.GAME_WIDTH / 2, C.GAME_HEIGHT - STRIP_H - 30, '', {
        fontFamily: UI_FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#edf1f7',
        backgroundColor: '#070a11dd',
        padding: { x: 14, y: 7 },
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(100);
    this.bossBar = s.add.graphics().setScrollFactor(0).setDepth(100);
    this.bossName = s.add
      .text(C.GAME_WIDTH / 2, 70, '👑 BERGAKUNGEN', mono(15, '#e8d8a0', { fontStyle: 'bold' }))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);
    this.openingText = s.add
      .text(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2 - 40, '', mono(46, '#e8e8f4'))
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(130)
      .setAlpha(0);
    this.openingSub = s.add
      .text(C.GAME_WIDTH / 2, C.GAME_HEIGHT / 2 + 12, '', mono(20, '#9fe0b0'))
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(130)
      .setAlpha(0);
    this.bannerText = s.add
      .text(C.GAME_WIDTH / 2, 170, '', mono(40, '#e8e8f4'))
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(120)
      .setAlpha(0);
    s.add
      .text(C.GAME_WIDTH / 2, 16, 'TUNNELBANA', mono(14, '#8888a0'))
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100);
    this.pausedText = pausePanel(s);
    s.uiMode = false;
  }

  /** a line that stays a while: something that happened */
  msg(text: string, now: number) {
    this.msgText.setText(text).setColor('#edf1f7').setVisible(true);
    this.msgUntil = now + 2500;
  }

  /** a line that lasts only as long as it keeps being said: what E does here */
  hint(text: string, now: number) {
    this.msgText.setText(text).setColor('#ffd23f').setVisible(true);
    this.msgUntil = now + 100;
  }

  /** the web fonts arrived after the texts were drawn: draw them again */
  refreshFonts() {
    for (const t of [...this.status.texts(), this.msgText, this.hpLabel, this.manaLabel]) t.updateText();
  }

  banner(name: string) {
    this.bannerText.setText(name.toUpperCase()).setAlpha(1);
    this.scene.tweens.add({ targets: this.bannerText, alpha: 0, delay: 1400, duration: 700 });
  }

  draw(sim: Run, now: number, frame: HudFrame) {
    this.drawOpening(sim, frame.opening);
    this.drawBoard(sim);
    this.drawDirHint(sim);
    // the panel holds its longest line: "take 17 → … or 19 → Hagsätra" ran off it
    this.boardBack.width = Math.max(430, this.boardText.width + 24, this.dirHint.width + 24);
    drawVitals(this.vitals, this.hpLabel, this.manaLabel, this.hurtVignette, sim, now);
    const dim = this.muted ? 0.3 : 1;
    this.boardText.setAlpha(0.92 * dim);
    this.dirHint.setAlpha(dim);
    this.vitals.setAlpha(dim);
    this.hpLabel.setAlpha(dim);
    this.manaLabel.setAlpha(dim);
    this.status.draw(sim, now, dim, (this.scene as unknown as { warp?: number }).warp ?? 1);
    this.pausedText.setVisible(frame.paused && !frame.runOver && !frame.startScreen);
    drawBossBar(this.bossBar, this.bossName, sim);
    if (!frame.runOver) this.drawContextHints(sim, now);
    if (now > this.msgUntil) this.msgText.setText('').setVisible(false);
  }

  /** where you are, and the next leg of your journey */
  private drawBoard(sim: Run) {
    const st = sim.here;
    const station = asStation(st);
    const capital = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
    const legText = (l: RouteLeg) =>
      `${capital(l.service.color)} ${l.service.id} → ${l.to} (${l.stops} stop${l.stops > 1 ? 's' : ''})`;
    const chain = sim.ride > 0 ? `   ·  RIDE ${sim.ride + 1}  ·  ${sim.banked} banked` : '';
    const lines = [`◉ ${shownName(st.name, sim.tutorial)}   →  ${sim.destStation}${chain}`];
    // a stacked station is several rooms: say which one you are standing in,
    // and where the train you need is waiting if it is not this one
    if (station && station.levelCount > 1) {
      const want = sim.route[0];
      const there = want ? levelOfService(station.name, want.service.id, want.dir) : null;
      lines.push(
        there !== null && there !== station.storey
          ? `level ${station.storey}  ·  your train is on level ${there}`
          : `level ${station.storey} of ${station.levelCount}`,
      );
    }
    if (st.name === sim.destStation) {
      lines.push('AT YOUR GOAL: an EXIT banks the ride and deals the next');
    } else {
      sim.route.slice(0, 2).forEach((l, i) => lines.push(`${i + 1}. ${legText(l)}`));
      if (sim.route.length > 2) lines.push(`   …+${sim.route.length - 2} more`);
    }
    this.boardText.setText(lines.join('\n'));
  }

  /** arrows pointing to the track you need */
  private drawDirHint(sim: Run) {
    const st = sim.here;
    const me = sim.me;
    const leg0 = sim.route[0];
    if (st.name === sim.destStation) {
      this.dirHint.setText('▣  You are at your stop. An EXIT banks the ride');
      setTextColor(this.dirHint, '#ffd23f');
      return;
    }
    if (!leg0) {
      this.dirHint.setText('');
      return;
    }
    const ri = st.rails.findIndex((rl) =>
      rl.options.some((o) => o.service.id === leg0.service.id && o.dir === leg0.dir),
    );
    if (ri < 0) {
      this.dirHint.setText('');
      return;
    }
    const rail = st.rails[ri];
    const plat = st.platforms.findIndex((pf) => pf.railTop === ri || pf.railBottom === ri);
    const onPlat = me.frame.kind === 'world' ? st.platformAt(me.y) : -1;
    // "take 13 → Norsborg or 14 → Fruängen": the board shows each train by
    // its OWN terminus, so the hint has to name them that way too (from play
    // 2026-09-25: "which train should I take?")
    const nums = rail.options.map((o) => `${o.service.id} → ${shortName(o.terminus)}`).join(' or ');
    let arrows: string;
    if (onPlat < 0 || onPlat === plat) {
      // right platform (or riding): this island's edge, no arrow to mislead
      arrows = '▣';
    } else {
      // wrong island: point the way, one arrow per platform to cross
      const steps = Math.abs(plat - onPlat);
      arrows = (plat < onPlat ? '▲' : '▼').repeat(Math.min(3, steps + 1));
    }
    const where = onPlat >= 0 && onPlat !== plat ? `  (platform ${plat + 1})` : '';
    this.dirHint.setText(`${arrows}  take ${nums}${where}`);
    setTextColor(this.dirHint, '#8ef0a8');
  }

  /** what E would do where you stand, and the states that need saying */
  private drawContextHints(sim: Run, now: number) {
    const st = sim.here;
    const me = sim.me;
    const onShaft = shaftAt(st, me, me.x, me.y);
    if (onShaft) {
      const to = stationPlan(st.name).levels[st.levelIndex - onShaft.delta];
      this.hint(`Press E: ${onShaft.delta > 0 ? 'up' : 'down'} to level ${to?.level ?? '?'}`, now);
    }
    const onFloor = me.frame.kind === 'world' && !me.offer;
    // (not in the tutorial: it starts beside a kiosk, and the hint sat under
    // every one of its lessons, from the alpha UX pass, 2026-09-30)
    if (onFloor && !this.muted && nearFixture(st, st.kiosks, me.x, me.y, C.M(2.2))) {
      this.hint(
        st.cleared ? 'Press E: the kiosk is open' : 'The kiosk is shuttered until the station is cleared',
        now,
      );
    }
    if (onFloor && atVendor(sim, me)) this.hint('Press E: someone is trading in the dark', now);
    if (onFloor && askerNear(sim, me)) this.hint('Press E: give them 10 kr', now);
    if (!me.offer && dealerNear(sim, me)) this.hint('Press E: he opens his bag', now);
    if (me.alive && me.downed)
      this.hint('DOWNED: a teammate can kneel beside you (hold E) to bring you back', now);
    // the cards are up: say whether the world is waiting for you
    if (me.offer && me.offer.kind === 'perk') {
      const left = sim.pause?.left ?? 0;
      this.hint(
        !sim.pause
          ? 'The world is moving: choose!'
          : Number.isFinite(left)
            ? `Choose: the world waits ${Math.ceil(left / 60)} s`
            : 'Choose: the world is holding still',
        now,
      );
    }
    if (nearExit(st, me)) {
      this.hint(
        st.name === sim.destStation
          ? 'Press E: bank this ride and ride on'
          : `Press E: wrong station, ride on with nothing banked (goal: ${sim.destStation})`,
        now,
      );
    }
  }

  /**
   * THE RUN'S TITLE CARD, over the opening shot.
   *
   * The world is held while the view comes down (render/arrival.ts), so this
   * is the one moment a player can read where they are going without anything
   * eating them. It fades out as the descent finishes rather than cutting,
   * so play begins without a seam.
   */
  private drawOpening(sim: Run, k: number) {
    if (k >= 1) {
      if (this.openingText.alpha !== 0) {
        this.openingText.setAlpha(0);
        this.openingSub.setAlpha(0);
      }
      return;
    }
    // legible from the first frame, gone by the last: it is a card, not a
    // flourish, and the thing under it is what the player came to look at
    const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    this.openingText.setText(shownName(sim.here.name, sim.tutorial)).setAlpha(fade);
    this.openingSub.setText(`to ${sim.destStation}`).setAlpha(fade * 0.9);
  }
}
