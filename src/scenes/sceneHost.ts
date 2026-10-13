import type Phaser from 'phaser';
import type { RunHost } from '../sim/run.ts';
import type { DemoScene } from './DemoScene.ts';
import { nextRide } from './betweenRides.ts';

/**
 * THE RUN HOST: everything the simulation may ask of the picture, a HUD
 * line, a banner, a camera feeling, a station to dress, answered by the
 * scene's views.
 */
export function makeRunHost(scene: DemoScene): RunHost {
  const cam = (): Phaser.Cameras.Scene2D.Camera => scene.cameras.main;
  return {
    msg: (text) => {
      if (!scene.session.resuming) scene.hostMsg(text);
    },
    hint: (text) => {
      if (!scene.session.resuming) scene.hud.hint(text, scene.gameNow);
    },
    banner: (name) => {
      if (!scene.session.resuming) scene.hud.banner(name);
    },
    feel: (seat, kind) => {
      if (seat !== scene.sim.localId || scene.session.resuming) return;
      const c = cam();
      if (kind === 'hit') c.flash(120, 160, 30, 30);
      else if (kind === 'death') c.flash(350, 200, 20, 20);
      else if (kind === 'jolt') c.shake(200, 0.004);
      else if (kind === 'arrive') c.shake(150, 0.003);
      else if (kind === 'tumble') c.shake(150, 0.004);
      else if (kind === 'warn') c.shake(300, 0.004);
    },
    // ON THE MAP NOTHING MOVES WHEN YOU CHANGE ROOMS: a mouth is a line on
    // the floor, not a change of coordinates, so there is nothing to hold
    // across it. Only a STOREY is a real relocation out here.
    stationChanging: () => {},
    stationChanged: (kind) => {
      scene.playerView.place(scene.me);
      const p = scene.drawnAt(scene.me);
      if (kind === 'shaft') cam().centerOn(p.x, p.y);
      scene.updateCameraBounds();
    },
    railsChanged: () => scene.world.railsChanged(),
    dressStation: () => {
      scene.world.sync(scene.sim);
      scene.updateCameraBounds();
    },
    runOver: () => scene.session.showRunOver(),
    arrived: (summary) => {
      if (scene.session.resuming) return;
      scene.rideDone.victory(summary, nextRide(scene.sim));
      scene.session.saveRun();
    },
  };
}
