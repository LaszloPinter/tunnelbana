import { NULL_HOST, Run } from '../../src/sim/run.ts';
import { fingerprint } from '../../src/sim/fingerprint.ts';
import { CHOICE, InputEdges } from '../../src/sim/tick.ts';
import { ALL_STATIONS } from '../../src/core/network.ts';
import { stationPlan } from '../../src/data/platformPlan.ts';
import { bot } from './drive.ts';
import { gainXp } from '../../src/combat/enemyDeath.ts';

/** every station's layout on seed 1, and the replay bot's per-second fingerprints on seeds 1-6 */
export function goldenDump(): string {
  const out: string[] = [];
  const log = (line: string) => out.push(line);
  const sim = new Run(NULL_HOST);
  sim.seedPinned = true;
  sim.runSeed = 1;
  sim.startRun();
  for (const name of ALL_STATIONS) {
    for (let li = 0; li < stationPlan(name).levels.length; li++) {
      const st = sim.makeStation(name, li);
      const rails = st.rails.map(
        (r) =>
          `slot${r.slot}:${r.color}:${r.dir}:${r.bandTop | 0}-${r.bandBottom | 0}:e${r.edgeY | 0}:${r.options.map((o) => o.service.id + o.dir).join('/')}:cur=${r.current.service.id}${r.current.dir}:short=${r.short}:stock=${r.train.stock.id}:cy=${r.train.centerY | 0}`,
      );
      const pfs = st.platforms.map(
        (p) => `${p.top | 0}-${p.bottom | 0}:${p.color}:${p.railTop}/${p.railBottom}`,
      );
      log(
        `L ${name}#${li} x=${st.platformX0 | 0}..${st.platformX1 | 0} y=${st.worldTopY | 0}..${st.worldBottomY | 0} cover=${st.coverLeft.toFixed(2)}/${st.coverRight.toFixed(2)} storey=${st.storey} | ${pfs.join(' ')} | ${rails.join(' ')} | benches=${st.benches.length} pillars=${st.pillars.length} esc=${st.escalators.map((e) => e.x | 0).join(',')} kiosks=${st.kiosks.map((k) => k.x | 0).join(',')}`,
      );
    }
  }

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const startLevel = seed % 2 ? 5 : 12;
    const s = new Run(NULL_HOST);
    s.seedPinned = true;
    s.runSeed = seed;
    s.startRun();
    s.beginRun();
    while (s.party.level < startLevel - 1) gainXp(s.hereHost, s.party.xpNext - s.party.xp);
    if (startLevel > 1) gainXp(s.hereHost, s.party.xpNext - s.party.xp - 1);
    const edges = new InputEdges();
    const prints: string[] = [];
    for (let t = 0; t < 9000; t++) {
      const b = bot(s, t);
      const input = edges.sample(
        b.held,
        b.mx,
        b.my,
        b.aimX,
        b.aimY,
        s.me.offer ? CHOICE.card(0) : CHOICE.none,
      );
      s.runTick(input);
      if (t % 60 === 59) prints.push(fingerprint(s.simState()).toString(16));
      if (s.over) break;
    }
    log(
      `R seed ${seed} ticks=${s.clock.tick} stops=${s.stopsTraveled} kills=${s.me.kills} ${prints.join(' ')}`,
    );
  }
  return out.join('\n') + '\n';
}
