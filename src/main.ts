import Phaser from 'phaser';
import { deviceRatio } from './config.ts';
import { applyDeviceResolution } from './render/display.ts';
import { DemoScene } from './scenes/DemoScene.ts';
import { replayCheck, type ReplayOptions } from './dev/replay.ts';
import * as account from './net/account.ts';
import * as save from './save.ts';
import { randomPlayerName } from './ui/dom/names.ts';
import { installCrashReporter, setCrashContext } from './net/crash.ts';
import { installTouch } from './ui/dom/touch.ts';
import { installGuideButton } from './ui/dom/guideButton.ts';

// before anything else can go wrong: a crash in a player's browser is reported
installCrashReporter();

// The canvas is the whole window at DEVICE resolution (backing store in device
// pixels, CSS size in CSS pixels), and the scene's two cameras zoom the
// GAME_WIDTH x GAME_HEIGHT layout box up to fill it. That way shapes, sprites
// and text are all rasterised at the screen's own resolution instead of being
// stretched up from a fixed 1280x720 canvas.
const dpr = deviceRatio();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: Math.round(window.innerWidth * dpr),
  height: Math.round(window.innerHeight * dpr),
  backgroundColor: '#0b0b10',
  scene: [DemoScene],
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / dpr,
    autoRound: true,
  },
  render: { antialias: true, roundPixels: true },
  // a pad, if one is plugged in (scenes/input.ts pollPad)
  input: { gamepad: true },
});

// a phone: the thumbstick and buttons over the canvas (ui/dom/touch.ts)
installTouch();
// the guide's on/off switch over a run (ui/dom/guideButton.ts)
installGuideButton();

// dev convenience: poke the running game from the console
// (game.scene.getScene('demo')) when chasing a frame-time problem, and
// `tb.replayCheck()` to prove a run is a function of its seed and inputs
if (import.meta.env.DEV) {
  const w = window as unknown as { game: Phaser.Game; tb: Record<string, unknown> };
  w.game = game;
  w.tb = {
    replayCheck: (opts?: ReplayOptions) => replayCheck(game.scene.getScene('demo') as DemoScene, opts),
  };
}

// EVERYONE IS SIGNED IN, from before they press anything, anonymously, but
// signed in, so the first run anybody plays is already on the board. There is
// no local-only mode to fall out of and nothing to migrate later: choosing to
// sign in with Google LINKS this same account to an email rather than starting
// a new one. If the network is unreachable this quietly does nothing and the
// game plays exactly as it otherwise would.
const savedName = save.load().prefs.playerName || randomPlayerName();
if (!save.load().prefs.playerName) save.savePrefs({ playerName: savedName });
void account.start(savedName);

// ...with where in the run it happened, so it can often be replayed
setCrashContext(() => {
  const sim = (game.scene.getScene('demo') as DemoScene | null)?.sim;
  return sim
    ? `seed ${sim.runSeed} · tick ${sim.clock.tick} · ${sim.me.placeId} · ride ${sim.ride} · ${sim.over ? `over ${sim.over.kind}` : 'running'}`
    : '';
});

window.addEventListener('resize', () => applyDeviceResolution(game));
