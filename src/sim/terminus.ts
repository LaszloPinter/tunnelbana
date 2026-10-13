import * as C from '../config.ts';
import { journeyById } from '../core/fleet.ts';
import { stopWindowOf } from '../core/journeyMotion.ts';
import { platformSide } from '../combat/paxAboard.ts';
import { asStation } from './place.ts';
import type { Run } from './run.ts';
import { aboardPoint } from '../world/trainSeat.ts';
import { clearSpot, spawnAt } from '../world/walk2d.ts';

/**
 * SLUTSTATION, ALLA AV. A train at the last stop of its journey runs on past
 * the platform into the siding to turn, and the siding is not ground anyone
 * stands on: a rider who stayed aboard was carried out into the dark and
 * stayed there, where no bolt has a floor to fly over (from play
 * 2026-10-13, at Norsborg). As on SL, the train is emptied: when its doors
 * start to close at the end of the line, whoever is still aboard steps out
 * through the nearest door on the platform side.
 */
export function endOfLine(run: Run, now: number) {
  for (const p of run.players) {
    const f = p.frame;
    if (!p.alive || f.kind !== 'aboard' || !f.jid) continue;
    const st = asStation(run.places.get(p.placeId));
    const j = journeyById(f.jid);
    if (!st || !j) continue;
    const idx = j.stops.findIndex((s) => s.station === st.name);
    if (idx < 0 || idx !== j.stops.length - 1) continue;
    const w = stopWindowOf(f.jid, idx);
    if (!w || now < w.departAt - C.DOOR_CLOSE_LEAD_MS) continue;
    const rail = st.rails[f.ti];
    if (!rail || rail.journey !== f.jid) continue;
    // the nearest doorway, and out of it on the platform's side
    let rx = f.rx;
    let best = Infinity;
    for (const d of rail.train.doors) {
      const mid = (d.x0 + d.x1) / 2;
      if (Math.abs(mid - f.rx) < best) {
        best = Math.abs(mid - f.rx);
        rx = mid;
      }
    }
    const out = platformSide(run, st, f.jid, rx, now);
    const at = aboardPoint(f.jid, rx, out * (C.CAR_WIDTH / 2 + p.r + C.M(0.4)), now);
    if (!at) continue;
    const spot = clearSpot(run, at.x, at.y, p.r, 'platform');
    p.frame = { kind: 'world' };
    p.placeId = st.id;
    if (p.id === run.localId) run.hereId = st.id;
    spawnAt(run, p, spot.x, spot.y);
    run.showMsg(`Slutstation ${st.name}. Everybody off: this train goes no further.`, now, p);
  }
}
