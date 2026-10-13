// RAILS THAT CROSS IN AN X.
//
// Inside a bore each (service, direction) runs at its own lateral, and the
// order is meant to be kept from one mouth to the other (core/boreSlots.ts).
// Where it is not, a terminus platform on the far side, a branch laid on the
// wrong hand, two rails cross on the flat, which the player sees as an X in
// the tunnel (from play 2026-09-17) and the trains as a collision when they
// meet there. This samples every line path through every corridor and asks
// that no two keep changing sides.
import { SERVICES } from '../../src/core/network.ts';
import { linePathOf, pathPos } from '../../src/core/linePath.ts';
import { corridorOf } from '../../src/core/corridor.ts';
import { isWideBore } from '../../src/core/boreSlots.ts';
import * as C from '../../src/config.ts';

/** signed lateral of a point from a polyline, and how far along it (0..1) */
function lateralOf(pts: { x: number; y: number }[], x: number, y: number): { lat: number; u: number } {
  let best = { d2: Infinity, lat: 0, u: 0 };
  let acc = 0;
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++)
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i].x;
    const ay = pts[i].y;
    const bx = pts[i + 1].x;
    const by = pts[i + 1].y;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (len * len)));
    const px = ax + ex * t;
    const py = ay + ey * t;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < best.d2) best = { d2, lat: (-(x - px) * ey + (y - py) * ex) / len, u: (acc + len * t) / total };
    acc += len;
  }
  return { lat: best.lat, u: best.u };
}

const faults: string[] = [];
let corridors = 0;
const seen = new Set<string>();
for (const svc of SERVICES) {
  for (let i = 0; i + 1 < svc.stations.length; i++) {
    const a = svc.stations[i];
    const b = svc.stations[i + 1];
    const c = corridorOf(a, b);
    if (!c) continue;
    const key = `${c.a}|${c.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // the four-track trunk out of Slussen is drawn as a crossover the whole
    // leg long on purpose (core/boreSlots.ts): the braid is not a fault
    if (isWideBore(c)) continue;
    corridors += 1;
    // every (service, dir) through this corridor: its lateral in 20 bins
    const slots: { id: string; bins: (number | null)[] }[] = [];
    for (const s of SERVICES) {
      const j = s.stations.indexOf(a);
      const k = s.stations.indexOf(b);
      if (j < 0 || k < 0 || Math.abs(j - k) !== 1) continue;
      for (const dir of [1, -1] as const) {
        const path = linePathOf(s.id, dir);
        if (!path) continue;
        const lo = Math.min(j, k);
        const hi = Math.max(j, k);
        const idx = dir === 1 ? [lo, hi] : [s.stations.length - 1 - hi, s.stations.length - 1 - lo];
        const S0 = path.stopS[idx[0]];
        const S1 = path.stopS[idx[1]];
        if (S0 === undefined || S1 === undefined) continue;
        const bins: (number | null)[] = new Array(20).fill(null);
        for (let n = 0; n <= 200; n++) {
          const p = pathPos(path, S0 + ((S1 - S0) * n) / 200);
          const l = lateralOf(c.pts, p.x, p.y);
          // only the bore itself, clear of both platforms
          if (l.u < 0.08 || l.u > 0.92) continue;
          const bin = Math.min(19, Math.floor(l.u * 20));
          if (bins[bin] === null) bins[bin] = l.lat;
        }
        slots.push({ id: `${s.id}${dir > 0 ? '+' : '-'}`, bins });
      }
    }
    for (let p = 0; p < slots.length; p++) {
      for (let q = p + 1; q < slots.length; q++) {
        let sign = 0;
        let at = -1;
        for (let bin = 0; bin < 20; bin++) {
          const l1 = slots[p].bins[bin];
          const l2 = slots[q].bins[bin];
          if (l1 === null || l2 === null) continue;
          const d = l1 - l2;
          if (Math.abs(d) < C.M(0.5)) continue; // shared slot (17/18/19)
          const s = d > 0 ? 1 : -1;
          if (sign !== 0 && s !== sign) {
            at = bin;
            break;
          }
          sign = s;
        }
        if (at >= 0)
          faults.push(
            `${c.a} ↔ ${c.b}: ${slots[p].id} and ${slots[q].id} change sides about ${Math.round((at / 20) * 100)}% of the way from ${c.a}`,
          );
      }
    }
  }
}
const ok = faults.length === 0;
console.log(
  `railcross: ${corridors} corridors, ${faults.length} pairs of rails cross in an X / ${ok ? 'PASS' : 'FAIL'}`,
);
for (const f of faults.slice(0, 20)) console.log(`  ${f}`);
process.exit(ok ? 0 : 1);
