import { debugAllowed } from '../dev/gate.ts';
import { downloadRun, loadRunFile } from '../dev/runFile.ts';
import { Lab } from '../ui/dom/lab.ts';
import type { PerfHud } from '../render/perfHud.ts';
import type { MapDebug } from '../render/mapDebug.ts';
import type { DemoScene } from './DemoScene.ts';
import type { InputSampler } from './input.ts';
import { cycleRenderScale, devKeys } from './viewport.ts';

/**
 * EVERYTHING BEHIND L: the lab, the run file, and the instruments (F frame
 * times, G render scale, C curve, J the map's answers). None of it exists
 * until the gate says this browser may have it (dev/gate.ts), a dev build
 * always, a public one only with the passphrase.
 */
export class SceneDebug {
  private lab: Lab | null = null;

  constructor(
    private readonly scene: DemoScene,
    private readonly perf: PerfHud,
    private readonly map: MapDebug,
  ) {}

  async enable(q: URLSearchParams, openLab: boolean) {
    if (!(await debugAllowed(q))) return;
    const scene = this.scene;
    const session = scene.session;
    this.lab = new Lab(
      () => scene.sim,
      [
        {
          label: 'Download run',
          run: () => {
            void downloadRun(session, this.perf.spikes).then((name) => scene.hostMsg(`Saved ${name}`));
            return 'downloading…';
          },
        },
        { label: 'Load run…', run: () => loadRunFile(session) },
        { label: 'Frames (F)', run: () => this.perf.toggle() },
        { label: 'Map (J)', run: () => this.map.toggle() },
        { label: 'Scale (G)', run: () => cycleRenderScale(scene) },
      ],
      () => (session.devRun = true),
    );
    if (openLab) this.lab.toggle();
  }

  /**
   * THE DEV HARNESS (development only): ?peek / ?lab pin a seed and start past
   * the briefing; ?zoom and ?cam move the camera, which the scene holds.
   */
  harness(q: URLSearchParams): { zoom: number; camX: number | null } {
    const session = this.scene.session;
    const sim = this.scene.sim;
    if (q.has('peek') || q.has('lab')) {
      session.devRun = true;
      sim.seedPinned = true;
      sim.runSeed = Number(q.get('peek') || q.get('lab') || '1') || 1;
      session.newRun();
      session.beginRun();
    }
    const z = Number(q.get('zoom'));
    const cam = q.get('cam');
    return { zoom: Number.isFinite(z) && z > 0 ? z : 0, camX: cam !== null ? Number(cam) : null };
  }

  update(k: InputSampler) {
    if (!this.lab) return;
    const scene = this.scene;
    const local = scene.session.local;
    devKeys({
      down: (n) => k.justDown(n),
      scene,
      sim: scene.sim,
      local,
      perf: this.perf,
      debug: this.map,
      say: (t) => scene.hostMsg(t),
    });
    if (k.justDown('L') && local) this.lab.toggle();
    this.lab.tick();
  }
}
