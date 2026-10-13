import { fromBase64, gunzip, gzip, toBase64 } from '../sim/inputLog.ts';
import type { SavedRun } from '../save.ts';
import type { Session } from '../scenes/session.ts';
import { resumeSaved } from '../scenes/saveRun.ts';

/**
 * A RUN AS A FILE, for the debug panel (L): the seed and every input so far,
 * the run itself, since the sim is a function of the two (§11c), plus
 * where it stood and how the frames were going when it was taken. Download
 * it mid-run, hand it over, and `node --experimental-strip-types
 * scripts/replay-file.ts <file>` replays it headless; "Load run" replays it
 * in the page to the tick it was taken at, to look at.
 */
export interface RunFile extends SavedRun {
  kind: 'tunnelbana-run';
  /** the run the file was taken from was a dev run (?peek / the lab): the
   * lab writes the sim outside a tick, so such a replay may part ways */
  dev: boolean;
  curve: number;
  where: Record<string, unknown>;
  /** frames over the spike line, most recent last */
  spikes: unknown[];
  url: string;
  agent: string;
}

export async function downloadRun(session: Session, spikes: unknown[]): Promise<string> {
  const sim = session.scene.sim;
  const me = sim.me;
  const packed = await gzip(session.inputLog.toBytes());
  const file: RunFile = {
    kind: 'tunnelbana-run',
    seed: sim.runSeed,
    daily: session.dailyDate,
    ticks: session.inputLog.ticks,
    log: toBase64(packed),
    ride: sim.ride,
    station: sim.station,
    dest: sim.destStation,
    seconds: Math.round((sim.gameNow - sim.runWallStart) / 1000),
    build: __BUILD_SHA__,
    savedAt: Date.now(),
    dev: session.devRun,
    curve: sim.curveStrength,
    where: {
      tick: sim.clock.tick,
      place: me.placeId,
      frame: me.frame,
      x: Math.round(me.x),
      y: Math.round(me.y),
      hp: Math.round(me.health),
      level: sim.party.level,
      stops: sim.stopsTraveled,
      pause: sim.pause,
      over: sim.over,
    },
    spikes,
    url: location.href,
    agent: navigator.userAgent,
  };
  const name = `tunnelbana-run-${file.seed}-t${file.ticks}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return name;
}

/** pick a run file and replay it in the page, to the tick it was taken at */
export function loadRunFile(session: Session): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const file = JSON.parse(await f.text()) as RunFile;
      await gunzip(fromBase64(file.log)); // readable before anything is thrown away
      if (file.build !== __BUILD_SHA__)
        session.scene.hostMsg(`Taken by build ${file.build}, this is ${__BUILD_SHA__}: it may part ways.`);
      session.scene.sim.setCurve(file.curve ?? 0);
      await resumeSaved(session, file);
    } catch (err) {
      session.scene.hostMsg(`Not a run file: ${String(err)}`);
    }
  };
  input.click();
}
