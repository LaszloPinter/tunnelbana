import { asStation } from './place.ts';
import type { Run } from './run.ts';

/**
 * The simulation's state as plain data, what a fingerprint hashes and what
 * a snapshot would be. Everything that decides what happens next is here;
 * nothing that only decides what it looks like is. A train is a class, so it
 * is flattened to the numbers that drive it; the rest is already plain.
 */
export function simState(run: Run): Record<string, unknown> {
  const pl = run.here;
  // the platform half, when the seat is standing on one: a tunnel has no
  // waves, no boards and no furniture, and a fingerprint of nulls for them
  // says exactly that (sim/place.ts)
  const st = asStation(pl);
  return {
    tick: run.clock.tick,
    held: run.clock.held,
    party: run.party,
    pause: run.pause,
    graceSpent: run.graceSpent,
    place: pl.id,
    station: pl.name,
    destStation: run.destStation,
    levelIndex: pl.levelIndex,
    stopsTraveled: run.stopsTraveled,
    ride: run.ride,
    banked: run.banked,
    stopsTotal: run.stopsTotal,
    rideStart: run.rideStart,
    rideStreak: run.rideStreak,
    missedTrains: st?.missedTrains ?? 0,
    manaBuysHere: st?.manaBuysHere ?? 0,
    corruption: pl.corruption,
    stationEnteredAt: st?.stationEnteredAt ?? 0,
    runStart: run.runStart,
    waveTotal: st?.waveTotal ?? 0,
    wave: st?.wave ?? 0,
    nextWaveAt: st?.nextWaveAt ?? 0,
    waveStartedAt: st?.waveStartedAt ?? 0,
    waveSize: st?.waveSize ?? 0,
    cleared: pl.cleared,
    bossKills: run.bossKills,
    // ...and every place the run is holding, so a tunnel that has answered
    // and a station that has been cleared are both in the fingerprint
    places: [...run.places.keys()].sort().map((id) => {
      const q = run.places.get(id)!;
      return { id, cleared: q.cleared, enemies: q.enemies.length, coins: q.coins.length };
    }),
    nextRideAttackAt: run.nextRideAttackAt,
    nextStrikeAt: run.nextStrikeAt,
    nextEnemyId: run.nextEnemyId,
    nextProjId: run.nextProjId,
    nextLootId: run.nextLootId,
    // the passengers are state like the horde: where, how hurt, and when they strike
    pax: run.pax,
    nextPaxId: run.nextPaxId,
    paxNet: run.paxNet,
    // the station as the simulation feels it: what blocks, where things
    // stand, a bench in a different place on one client is a desync like
    // any other
    platformX0: pl.x0,
    platformX1: pl.x1,
    benches: pl.benches,
    pillars: pl.pillars,
    escalators: pl.escalators,
    shafts: pl.shafts,
    kiosks: pl.kiosks,
    manaMachines: pl.manaMachines,
    healthMachines: pl.healthMachines,
    players: run.players,
    enemies: pl.enemies,
    projs: pl.projs,
    coins: pl.coins,
    pickups: pl.pickups,
    stains: pl.stains,
    acidPools: pl.acidPools,
    strikes: pl.strikes,
    boardings: pl.boardings,
    rails: pl.rails.map((r) => ({
      slot: r.slot,
      color: r.color,
      dir: r.dir,
      service: r.current.service.id,
      next: r.current.next,
      journey: r.journey ?? null,
      short: r.short,
      edgeY: r.edgeY,
      train: {
        phase: r.train.phase,
        x: r.train.x,
        speed: r.train.speed,
        doorFrac: r.train.doorFrac,
        doorsOpen: r.train.doorsOpen,
        arriveAt: r.train.arriveAt,
        departAt: r.train.departAt,
        cars: r.train.carCount,
        centerY: r.train.centerY,
        dir: r.train.dir,
        stock: r.train.stock.id,
      },
    })),
  };
}
