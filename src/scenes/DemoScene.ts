import Phaser from 'phaser';
import * as C from '../config.ts';
import { aimWorld, type Player } from '../sim/player.ts';
import { CHOICE, type TickInput } from '../sim/tick.ts';
import type { Controls } from '../sim/ticks.ts';
import { Run } from '../sim/run.ts';
import type { ChoiceScreen } from '../ui/overlays.ts';
import { FxView } from '../render/fxView.ts';
import { preloadAssets } from '../render/assets.ts';
import { buildFxTextures } from '../render/creatureArt.ts';
import { PlayerView } from '../render/playerView.ts';
import { randomLook } from '../render/look.ts';
import { savedLook } from '../save.ts';
import { bakeLabels } from '../render/labelArt.ts';
import { bakeWallArt } from '../render/wallArt.ts';
import { PerfHud } from '../render/perfHud.ts';
import { Hud } from './hud.ts';
import { CardsHud } from './cardsHud.ts';
import { WorldChart } from './worldChart.ts';
import { camRect, MapView } from '../render/mapView.ts';
import { RunCamera } from '../render/runCamera.ts';
import { MapDebug } from '../render/mapDebug.ts';
import { Session } from './session.ts';
import { InputSampler } from './input.ts';
import { makeRunHost } from './sceneHost.ts';
import { SceneDebug } from './sceneDebug.ts';
import { RideDoneScreen } from '../ui/dom/rideDone.ts';
import { TutorialMarks } from './tutorialMarks.ts';
import { padChoice, padMenu } from './padNav.ts';
import { syncRideDone } from './betweenRides.ts';
import { runFrameTicks } from './tickLoop.ts';
import { fitViewports } from './viewport.ts';

/**
 * THE PICTURE OF THE RUN. The scene drives the simulation's ticks, answers
 * its RunHost callbacks (sceneHost.ts), samples the keyboard and mouse into
 * tick input (input.ts), and owns the cameras. What it draws it draws
 * through views, each a map from id to picture, and the HUD, the cards,
 * the place's dressing and the session around the run are each their own
 * module.
 */
export class DemoScene extends Phaser.Scene {
  /** THE SIMULATION, everything that decides what happens (src/sim/run.ts) */
  sim!: Run;
  session!: Session;
  hud!: Hud;
  /** every live place's picture, standing where it stands */
  world!: WorldChart;
  /** Stockholm drawn as itself (render/mapView.ts) */
  mapView!: MapView;
  /** J: the map with its own answers drawn on it (render/mapDebug.ts) */
  private mapDebug!: MapDebug;
  /** where the view is pointed, and the shot a run opens with */
  private readonly cam = new RunCamera();

  playerView!: PlayerView;
  private cards!: CardsHud;
  inputs!: InputSampler;
  private fxView!: FxView;
  private aimDot!: Phaser.GameObjects.Arc;
  private perf!: PerfHud;
  /** the fixed camera the HUD lives on; the main camera holds the world */
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private renderScale = 1;
  /** while true, everything created is tagged for the HUD camera */
  uiMode = false;

  runOver: Phaser.GameObjects.GameObject[] | null = null;
  /** the pre-run briefing: from, to, and a START button */
  startScreen: Phaser.GameObjects.GameObject[] | null = null;
  /** the cards on screen, while the local seat has an offer up */
  choosing: ChoiceScreen | null = null;
  private paused = false;
  private devZoom = 0; // ?zoom=0.07, held every frame, since other things set zoom too
  private devCamX: number | null = null;
  warp = 1; // the ride's fast-forward this frame (scenes/tickLoop.ts rideWarp)
  warpClearSince = 0;
  lastPointer = { x: 0, y: 0 }; // last frame's, for the tutorial's aim stage
  /** the tutorial's ring and fence, in the world (scenes/tutorialMarks.ts) */
  private tutMarks!: TutorialMarks;
  /** between rides: the victory, then the ride to come (ui/dom/rideDone.ts) */
  rideDone!: RideDoneScreen;
  /** L: the lab, the run file, the instruments, gated (scenes/sceneDebug.ts) */
  private debug!: SceneDebug;

  constructor() {
    super('demo');
  }

  // ---- what the overlays, the views and the dev harness read ----
  get me() {
    return this.sim.me;
  }
  get party() {
    return this.sim.party;
  }
  get station() {
    return this.sim.station;
  }
  get destStation() {
    return this.sim.destStation;
  }
  get route() {
    return this.sim.route;
  }
  get gameNow() {
    return this.sim.gameNow;
  }
  worldY(x: number, y: number) {
    return this.sim.worldY(x, y);
  }
  /** WHERE A SEAT IS DRAWN: on the map a body's position IS where it is drawn */
  drawnAt(p: Player): { x: number; y: number } {
    return { x: p.x, y: p.y };
  }
  drawAngle(x: number, dx: number, dy: number) {
    return this.sim.here.drawAngle(x, dx, dy);
  }
  /** where a player is drawn in this view */
  viewOf(p: Player) {
    return { x: p.x, y: p.y };
  }

  preload() {
    preloadAssets(this);
  }

  create() {
    // Two cameras: the world camera follows the player; a fixed one draws
    // the HUD. Every object made from here on is tagged for exactly one.
    this.uiCam = this.cameras.add(0, 0, C.GAME_WIDTH, C.GAME_HEIGHT, false, 'ui').setOrigin(0, 0);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (go: Phaser.GameObjects.GameObject) => {
      if (this.uiMode) this.cameras.main.ignore(go);
      else this.uiCam.ignore(go);
    });
    this.renderScale = fitViewports(this, this.uiCam);
    this.scale.on(Phaser.Scale.Events.RESIZE, () => (this.renderScale = fitViewports(this, this.uiCam)));

    // the canvas is the window in device pixels and the cameras zoom the
    // layout box up to it; text is a baked texture, so it needs the scale first
    const textRes = Math.min(4, Math.max(1, this.renderScale));
    const factory = this.add;
    const origText = factory.text.bind(factory);
    factory.text = ((x: number, y: number, text: string | string[], style?: Record<string, unknown>) =>
      origText(x, y, text, { resolution: textRes, ...(style ?? {}) })) as typeof factory.text;
    bakeLabels(this, textRes);
    bakeWallArt(this);
    this.fxView = new FxView(this);

    // THE SIMULATION, constructed before anything that draws its state
    this.sim = new Run(makeRunHost(this));
    this.inputs = new InputSampler(this);
    this.session = new Session(this);
    this.rideDone = new RideDoneScreen(() => this.choose(CHOICE.go));

    // only the rock backdrop is global; it spans the longest leg in the network
    const BACK = C.M(1700);
    const w = C.M(185 + 120);
    this.add.rectangle(w / 2, C.GAME_HEIGHT / 2, w + 2 * BACK, C.GAME_HEIGHT * 3, 0x101014).setDepth(-1);
    this.world = new WorldChart(this, textRes);
    this.mapView = new MapView(this);
    this.mapDebug = new MapDebug(this);
    buildFxTextures(this);
    const local = (id: number) => id === this.sim.localId;
    this.playerView = new PlayerView(this, (id) => (local(id) ? savedLook() : randomLook()), local);
    this.playerView.place(this.me);
    this.aimDot = this.add.circle(0, 0, 2.5, 0xffffff).setDepth(6.5).setAlpha(0.8);
    this.tutMarks = new TutorialMarks(this);
    this.cam.follow(this.cameras.main, this.playerView.rigOf(this.sim.localId));

    this.hud = new Hud(this);
    this.cards = new CardsHud(this);
    this.uiMode = true;
    this.perf = new PerfHud(this);
    this.uiMode = false;

    this.sim.station = 'T-Centralen';
    this.session.newRun();

    const q = new URLSearchParams(location.search);
    this.debug = new SceneDebug(this, this.perf, this.mapDebug);
    if (import.meta.env.DEV) {
      const dev = this.debug.harness(q);
      this.devZoom = dev.zoom;
      this.devCamX = dev.camX;
    }
    void this.debug.enable(q, import.meta.env.DEV && q.has('lab'));
    this.session.boot(q, import.meta.env.DEV && (q.has('peek') || q.has('lab')));
  }

  hostMsg(text: string) {
    this.hud.msg(text, this.gameNow);
  }

  /** a fresh run: fresh looks all round, no edge or pick carried over */
  onNewRun() {
    this.playerView.reroll(this);
    this.cards.clearKept();
    this.inputs.reset();
  }

  /** a new look chosen on the landing: dress the commuter in it now */
  onLookChanged() {
    this.playerView.reroll(this);
  }

  /** a room started: seats may have changed, follow the local one */
  onRoomStart() {
    this.playerView.place(this.me);
    this.cam.follow(this.cameras.main, this.playerView.rigOf(this.sim.localId));
  }

  /** how far the view is turned (src/world/bearing.ts) */
  viewAngle = () => this.cam.angle;
  updateCameraBounds() {
    this.cam.bounds(this.cameras.main);
  }

  /** the pointer in WORLD coordinates, `pointer.worldX` is whatever camera
   * the input system hit-tested last, and with a HUD camera on top that is
   * not the world */
  pointerWorld(): Phaser.Math.Vector2 {
    const p = this.input.activePointer;
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }
  playerWorld(): { x: number; y: number } {
    return { x: this.me.x, y: this.me.y };
  }

  update(_t: number, _smoothedMs: number) {
    // THE RAW DELTA, NOT PHASER'S. Phaser hands `update` a delta averaged
    // over the last ten frames and clamped, so a 33 ms hitch arrives as ten
    // frames of 18 ms: the tick the hitch owed runs at a random moment up to
    // ten frames later, and the readout never sees the hitch at all. A
    // fixed-step clock wants the truth of this frame (sim/tick.ts snapToStep
    // then squares it with the screen).
    const deltaMs = this.game.loop.rawDelta;
    const k = this.inputs;
    // the pad, once a frame: its edges for the meta keys, its held state for the ticks
    k.pollPad();
    padChoice(this);
    padMenu(this);
    // F, G, C, J and L are instruments, not controls (scenes/sceneDebug.ts)
    this.debug.update(k);
    // P and R are meta: pausing and restarting are things done TO a run,
    // not in it, and in a room they are the ROOM's decisions. ESC leaves.
    const local = this.session.local;
    if ((k.justDown('ESC') || k.padJustDown('back')) && local && !this.session.menuVisible) {
      this.paused = false;
      this.session.saveRun();
      this.session.showLanding();
      return;
    }
    const pauseKey = k.justDown('P') || k.padJustDown('start');
    if (pauseKey && local) this.paused = !this.paused;
    if (pauseKey && local && this.paused) this.session.saveRun();
    // a save being picked back up replays a chunk a frame (scenes/saveRun.ts)
    if (this.session.resumeFrame()) {
      this.draw(this.gameNow);
      return;
    }
    if (local && !this.paused && !this.startScreen && !this.runOver) this.session.autosave(performance.now());
    syncRideDone(this);
    if (k.justDown('R') && !this.startScreen && !this.runOver && local) {
      this.sim.station = 'T-Centralen';
      this.session.newRun();
    }
    // the cards being up does NOT stop the ticks, a pick is a SIM phase
    // (§16); only pause, the briefing and the run-over screen stop the clock
    const opening = this.cam.opening(this.time.now);
    // ...and so does the wait between rides, solo: nothing ticks until go
    const between = local && this.sim.pause?.kind === 'ride';
    const held = this.paused || this.runOver !== null || this.startScreen !== null || opening || between;
    const tSim = performance.now();
    const { ran, frozen } = runFrameTicks(this, deltaMs, held);
    const tDraw = performance.now();
    this.draw(this.gameNow);
    const tEnd = performance.now();
    this.perf.timings(tDraw - tSim, tEnd - tDraw);
    this.perf.atTick = this.sim.clock.tick;
    this.perf.sampleFrom(deltaMs, frozen ? 1 : ran, this.sim.here, this, tEnd);
  }

  // ---- the input, for the session's tick sources and the overlays ----
  readControls(): Controls {
    return this.inputs.readControls();
  }
  takeChoice(): number {
    return this.inputs.takeChoice();
  }
  sampleInput(): TickInput {
    return this.inputs.sampleInput();
  }
  choose(code: number) {
    this.inputs.choose(this.me, code);
  }
  closeChoice() {
    this.cards.closeChoice();
  }
  beginRun() {
    this.session.beginRun();
    // THE RUN OPENS: high over the station, turning level, coming down onto
    // the body (render/arrival.ts). It also hides the view's own settling,
    // which otherwise happens as a lurch just as you start reading the place.
    this.cam.open(this.time.now);
  }

  private draw(now: number) {
    const sim = this.sim;
    const st = sim.here;
    // during a replay the offers of the whole run would open and close in a
    // blur; the one still up when it ends opens then
    if (!this.session.resuming) this.cards.syncChoice();
    // the sim holds numbers; the pictures are made to match, by id, every
    // live place on the chart, each through its own views
    // THE OPENING RUNS ON THE WALL CLOCK: the world is held while it plays,
    // so the sim's clock does not advance, and the two were never the same
    // clock, which left the view stuck at the top of the descent (2026-09-12)
    this.cam.step(this.sim, this.me, this.cameras.main, this.time.now, this.renderScale, this.devZoom > 0);
    this.mapView.draw(sim, now, camRect(this.cameras.main));
    this.mapDebug.draw(sim);
    this.world.sync(sim);
    this.world.draw(this.sim, now, this.cameras.main);
    this.fxView.drain(sim.fx);
    // the commuters: one rig each, the local one's cursor dot on top
    this.playerView.sync(sim.players, now);
    const me = this.me;
    const at = this.drawnAt(me);
    const aimW = aimWorld(me, (x, y) => this.worldY(x, y));
    this.aimDot.setVisible(me.alive).setPosition(at.x + aimW.x * C.M(1.2), at.y + aimW.y * C.M(1.2));
    const tut = this.session.tutorial;
    this.hud.muted = !!tut;
    this.tutMarks.draw(sim, tut?.marker ?? null, this.time.now);
    this.hud.draw(sim, now, {
      paused: this.paused,
      runOver: this.runOver !== null,
      startScreen: this.startScreen !== null,
      opening: this.cam.progress(this.time.now),
    });
    this.cards.draw(me, this.inputs.isDown('TAB') || this.inputs.padHeld('Y') || this.paused);
    this.cam.dev(
      this.cameras.main,
      this.devZoom,
      this.devCamX === null
        ? null
        : { x: st.platformX0 + C.M(this.devCamX), y: (st.worldTopY + st.worldBottomY) / 2 },
    );
  }
}
