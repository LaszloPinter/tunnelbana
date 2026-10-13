import Phaser from 'phaser';
import { InputLog } from '../sim/inputLog.ts';
import type { TickInput } from '../sim/tick.ts';
import { clearSavedRun, findSavedRun, resumeFrame, resumeSaved, saveRun } from './saveRun.ts';
import { LocalTicks, RoomTicks, type ConfirmedTick, type Controls, type TickSource } from '../sim/ticks.ts';
import { scheduleFor, type Schedule } from '../core/schedule.ts';
import * as account from '../net/account.ts';
import * as save from '../save.ts';
import { Menu, dailySeed } from '../ui/dom/menu.ts';
import { randomPlayerName } from '../ui/dom/names.ts';
import { showStartScreen, type OverlayHost } from '../ui/overlays.ts';
import type { Run } from '../sim/run.ts';
import type { Room } from '../net/room.ts';
import { enterLobby, openRoom } from './lobby.ts';
import { showRunOver } from './runOver.ts';
import { Tutorial } from '../ui/dom/tutorial.ts';
import { myLook } from '../render/look.ts';
import { refreshBoard, showBoard } from './board.ts';

/** what the session drives on the scene */
export interface SessionScene extends OverlayHost {
  sim: Run;
  runOver: Phaser.GameObjects.GameObject[] | null;
  readControls(): Controls;
  takeChoice(): number;
  sampleInput(): import('../sim/tick.ts').TickInput;
  closeChoice(): void;
  onNewRun(): void;
  onRoomStart(): void;
  hostMsg(text: string): void;
  /** the player chose a new look on the landing */
  onLookChanged(): void;
}

/**
 * THE SESSION AROUND A RUN: where this frame's ticks come from (a local
 * clock solo, a lockstep room when one is open), the landing menu and the
 * lobby, the score at the end and what this browser remembers. None of it
 * is the run; all of it is what starts one and what it is worth.
 */
export class Session {
  /**
   * WHERE THIS FRAME'S TICKS COME FROM (src/sim/ticks.ts). The scene never
   * asks which it has: that question, as a mutable field, was the freeze
   * bug. Swapping modes is one assignment through `useLocalTicks` /
   * `useRoomTicks`, and those two are the only places a connection is ever
   * opened or given up.
   */
  ticks!: TickSource;
  /** every tick this run has run on: a seed plus this IS the run (§11c) */
  readonly inputLog = new InputLog(1);
  /** the UTC date, when this run is the day's challenge; null when it is not */
  dailyDate: string | null = null;
  saved = save.load();
  /** the landing, DOM over the canvas, built once and shown or hidden */
  menu: Menu | null = null;
  /** the timetable for the journey THIS run was dealt, captured when it started */
  runSchedule: Schedule | null = null;
  /** where the relay is, if there is one; multiplayer needs it (§19) */
  relayUrl: string | undefined;
  /** the lobby or the code entry, whichever is up */
  menuScreen: Phaser.GameObjects.GameObject[] | null = null;
  /**
   * A RESUME IN PROGRESS (src/save.ts SavedRun): the recorded inputs still
   * to replay. The run is a function of its seed and inputs, so playing them
   * back is the whole of loading a save; the scene holds its own ticks and
   * steps this a chunk a frame so the page stays alive.
   */
  resume: { queue: TickInput[]; at: number } | null = null;
  /** started by the dev harness (?peek, ?lab): never saved, never on the landing */
  devRun = false;
  /** THE TUTORIAL (ui/dom/tutorial.ts): a peaceful one-stop run with the
   * keys shown, never saved and never on the board. Everyone gets it once,
   * on a browser that has never played; Controls has a link to it after */
  tutorialRun = false;
  tutorial: Tutorial | null = null;
  lastAutosave = 0;
  saving = false;

  get resuming(): boolean {
    return this.resume !== null;
  }
  /** the save and the resume live in scenes/saveRun.ts */
  saveRun(): void {
    saveRun(this);
  }
  autosave(nowMs: number): void {
    if (nowMs - this.lastAutosave < 30_000) return;
    this.lastAutosave = nowMs;
    saveRun(this);
  }
  clearSavedRun(): void {
    clearSavedRun(this);
  }
  /** one frame of a resume: true while the replay is still catching up */
  resumeFrame(): boolean {
    return resumeFrame(this);
  }

  constructor(readonly scene: SessionScene) {
    this.useLocalTicks();
  }

  get local(): boolean {
    return this.ticks.local;
  }

  /** the dev harness and the room-from-URL flow, from the page's query */
  boot(q: URLSearchParams, peeking: boolean) {
    // With multiplayer out of the build there is no relay, no join link and
    // no room harness. `__MULTIPLAYER__` is a build-time literal, so these
    // branches fold away.
    this.relayUrl = __MULTIPLAYER__ ? (q.get('ws') ?? undefined) : undefined;
    const joinCode = __MULTIPLAYER__ ? q.get('join') : null;
    const roomName = __MULTIPLAYER__ ? q.get('room') : null;
    if (!roomName && !peeking) {
      if (__MULTIPLAYER__ && joinCode) enterLobby(this, joinCode.toUpperCase(), false);
      // a browser that has never played opens on the tutorial, not the board
      else if (!save.load().prefs.tutorialDone) this.startTutorial();
      else this.showLanding();
    }
    if (roomName) {
      // no ?seat= means 'give me whichever is free', the relay decides
      const seat = q.has('seat') ? Number(q.get('seat')) : -1;
      const seats = Number(q.get('seats') ?? '2');
      const seed = Number(q.get('seed') ?? '1');
      openRoom(this, { name: roomName, seat, seats, ws: q.get('ws') ?? undefined }, seed, () => {});
    }
  }

  /** a fresh run: the sim starts it, the scene dresses the moment */
  newRun() {
    const scene = this.scene;
    if (scene.runOver) {
      for (const g of scene.runOver) g.destroy();
      scene.runOver = null;
    }
    scene.closeChoice();
    scene.onNewRun();
    this.inputLog.reset();
    scene.sim.startRun();
    this.runSchedule = scene.sim.route.length ? scheduleFor(scene.sim.route) : null;
    showStartScreen(scene);
  }

  /** the START button: the briefing ends, the run's clocks start */
  beginRun() {
    const scene = this.scene;
    if (scene.startScreen) for (const g of scene.startScreen) g.destroy();
    scene.startScreen = null;
    scene.sim.beginRun();
  }

  useLocalTicks() {
    this.ticks?.dispose();
    this.ticks = new LocalTicks(this.scene.sim.clock, () => this.scene.sampleInput());
  }

  useRoomTicks(room: Room, queue: ConfirmedTick[]): RoomTicks {
    this.ticks?.dispose();
    const rt = new RoomTicks(
      room,
      () => this.scene.readControls(),
      () => this.scene.takeChoice(),
      queue,
    );
    this.ticks = rt;
    return rt;
  }

  clearMenu() {
    if (!this.menuScreen) return;
    for (const g of this.menuScreen) {
      const clean = g.getData?.('cleanup') as (() => void) | undefined;
      clean?.();
      g.destroy();
    }
    this.menuScreen = null;
  }

  /** the landing: the departure board, in DOM, over the canvas */
  showLanding() {
    this.clearMenu();
    // leaving a lobby gives the seat back and puts us on our own clock again
    this.useLocalTicks();
    this.saved = save.load();
    if (!this.menu) {
      this.menu = this.buildMenu();
      // the account arrives asynchronously and can change under us
      account.onAccount((a) =>
        this.menu?.setState({ linked: !!a?.linked, name: a?.name ?? this.saved.prefs.playerName }),
      );
    }
    this.menu.setState({ dailyDone: this.dailyDoneToday() });
    void refreshBoard(this.menu);
    void findSavedRun().then((s) =>
      this.menu?.setState({
        saved: s
          ? {
              ride: s.ride,
              station: s.station,
              dest: s.dest,
              seconds: s.seconds,
              daily: s.daily,
              stale: s.build !== __BUILD_SHA__,
            }
          : null,
      }),
    );
    this.menu.show();
    // Phaser listens on the window, so WASD in the seed field would otherwise
    // also be walking the player around behind the menu
    this.scene.input.keyboard!.enabled = false;
  }

  /** the run-over overlay, from the sim's verdict */
  showRunOver() {
    // the tutorial's end is not a result: arriving finishes it, and a death
    // (the tracks are still the tracks) puts you back on the platform with
    // your progress kept, not on a score screen
    if (this.tutorialRun) {
      // arriving shows the end card, which returns to the landing itself
      if (this.scene.sim.over?.kind === 'win') {
        if (this.tutorial) this.tutorial.finish();
        else this.endTutorial();
      } else this.restartTutorialRun();
      return;
    }
    showRunOver(this);
  }

  /** the tutorial: the peaceful run, and the overlay that teaches the keys over it */
  startTutorial() {
    this.menu?.hide();
    this.scene.input.keyboard!.enabled = true;
    this.devRun = false;
    this.dailyDate = null;
    this.tutorialRun = true;
    this.tutorial?.destroy();
    this.tutorial = new Tutorial({
      onSkip: () => this.endTutorial(),
      onDone: () => this.endTutorial(),
      onReady: () => this.scene.sim.tutorialReady(),
    });
    this.restartTutorialRun();
  }

  private restartTutorialRun() {
    const sim = this.scene.sim;
    sim.tutorial = true;
    sim.seedPinned = true;
    sim.runSeed = 1;
    this.newRun();
    // no briefing: the overlay is the briefing
    this.beginRun();
    // enough in the pocket for the mana machine, and a reason to use it
    sim.me.money = 60;
    sim.me.mana = 20;
  }

  /** skipped or finished: done for this browser either way, then the landing */
  endTutorial() {
    if (!this.tutorialRun) return;
    save.savePrefs({ tutorialDone: true });
    this.tutorial?.destroy();
    this.tutorial = null;
    this.tutorialRun = false;
    this.scene.sim.tutorial = false;
    // WHAT IS LEFT OF THE TUTORIAL IS NOT A RUN. It usually ends mid-ride,
    // with the run still going, and the next autosave filed it as one: a new
    // player's landing opened on "Continue · Solna centrum → Solna centrum"
    // (from the alpha UX pass, 2026-09-30). Never saved, and nothing kept.
    this.devRun = true;
    this.clearSavedRun();
    this.scene.closeChoice();
    this.showLanding();
  }

  get menuVisible(): boolean {
    return this.menu?.visible ?? false;
  }

  private buildMenu(): Menu {
    const name = this.saved.prefs.playerName || randomPlayerName();
    if (!this.saved.prefs.playerName) save.savePrefs({ playerName: name });
    return new Menu(
      {
        onPlay: (seed) => this.startFromMenu(seed, null),
        onDaily: (seed, date) => this.startFromMenu(seed, date),
        onName: (n) => {
          save.savePrefs({ playerName: n });
          this.saved = save.load();
          void account.saveName(n);
        },
        onLook: (look) => {
          save.savePrefs({ look });
          this.saved = save.load();
          this.scene.onLookChanged();
        },
        onLeaderboard: () => void showBoard(this.menu),
        onContinue: () => void resumeSaved(this),
        onDiscard: () => this.clearSavedRun(),
        onTutorial: () => this.startTutorial(),
      },
      {
        linked: false,
        name,
        look: myLook(
          () => save.load().prefs.look,
          (look) => save.savePrefs({ look }),
        ),
        version: __APP_VERSION__,
        build: __BUILD_SHA__,
        dailyDone: this.dailyDoneToday(),
        playedOnce: this.saved.prefs.playedOnce,
      },
    );
  }

  /** the menu chose a run: a seed, and whether it is the day's */
  private startFromMenu(seed: number, daily: string | null) {
    // a new run replaces the saved one: the landing says so beside Continue
    this.clearSavedRun();
    this.devRun = false;
    this.scene.sim.tutorial = false;
    // the first real run: the Play button has done its job
    if (!this.saved.prefs.playedOnce) {
      save.savePrefs({ playedOnce: true });
      this.saved = save.load();
      this.menu?.setState({ playedOnce: true });
    }
    this.menu?.hide();
    this.scene.input.keyboard!.enabled = true;
    this.scene.sim.seedPinned = true;
    this.scene.sim.runSeed = seed >>> 0;
    this.dailyDate = daily;
    this.newRun();
  }

  dailyDoneToday() {
    const today = dailySeed().date;
    const row = this.saved.daily.find((d) => d.date === today);
    return row ? { stops: row.stops, won: row.won } : undefined;
  }
}
