import { makePlayer } from '../sim/player.ts';
import type { ConfirmedTick } from '../sim/ticks.ts';
import { Room } from '../net/room.ts';
import { claimLocalSeat, showLobby } from '../ui/lobby.ts';
import type { Session } from './session.ts';

/**
 * THE LOBBY, hosting, or waiting in somebody else's, and the room behind
 * it. A room is a five-letter code; the relay starts the run itself the
 * moment every seat is taken, so there is no START to press.
 */
/** a lobby, hosting or joining, over whatever relay we were given */
export function enterLobby(session: Session, code: string, isHost: boolean, seats = 2) {
  session.clearMenu();
  const link = `${location.origin}${location.pathname}?join=${code}${
    session.relayUrl ? `&ws=${encodeURIComponent(session.relayUrl)}` : ''
  }`;
  const view = {
    code,
    link,
    seats,
    present: [] as number[],
    youAre: -1,
    isHost,
    status: session.relayUrl
      ? 'waiting for the seats to fill. The run starts by itself when they do'
      : 'no relay: this room reaches other TABS of this browser. Open the link in a second one.',
  };
  const redraw = () =>
    (session.menuScreen = showLobby(
      session.scene,
      view,
      isHost
        ? { onSeats: (n) => enterLobby(session, code, true, n), onBack: () => session.showLanding() }
        : { onBack: () => session.showLanding() },
    ));
  redraw();
  const present = new Set<number>();
  openRoom(
    session,
    // with a relay the relay hands out seats (-1 asks it to); without one
    // the tabs claim them between themselves
    { name: code, seat: session.relayUrl ? -1 : claimLocalSeat(code, seats), seats, ws: session.relayUrl },
    Math.floor(Math.random() * 0xffffffff) >>> 0,
    (seat, text) => {
      if (seat >= 0) present.add(seat);
      view.youAre = seat;
      view.present = [...present].sort();
      view.status = text;
      session.clearMenu();
      redraw();
    },
  );
}

/**
 * Connect to a room. The relay starts the run itself the moment every
 * seat is taken, so there is no START to press.
 */
export function openRoom(
  session: Session,
  opts: { name: string; seat: number; seats: number; ws?: string },
  seed: number,
  onSay: (seat: number, text: string) => void,
) {
  const scene = session.scene;
  // the queue exists BEFORE the room, so a tick delivered during
  // construction has somewhere to land (local mode dispatches synchronously)
  const pending: ConfirmedTick[] = [];
  const room = new Room(
    opts,
    {
      onStart: (sd, n, tick0) => {
        session.clearMenu();
        scene.sim.players = [];
        for (let i = 0; i < n; i++) scene.sim.players.push(makePlayer(i));
        scene.sim.localId = room.seatNumber;
        scene.sim.seedPinned = true;
        scene.sim.runSeed = sd;
        scene.sim.startTick = tick0;
        session.newRun();
        session.beginRun();
        scene.onRoomStart();
      },
      onTick: (tick, inputs) => pending.push({ tick, inputs }),
      say: (text) => {
        scene.hostMsg(text);
        onSay(room.seatNumber, text);
      },
    },
    seed,
  );
  session.useRoomTicks(room, pending);
}
