import { type TickInput } from './tick.ts';

/**
 * THE RUN, AS THE ONLY THING THAT ACTUALLY HAPPENED.
 *
 * A run is a pure function of its seed and the inputs that went into it,
 * that is what `scripts/check-replay.ts` proves twice a build. So a seed plus
 * this log IS the run, completely, and anyone holding both can re-simulate it
 * and see for themselves what the score was. No trust required.
 *
 * That is the whole reason to record it now, before there is any leaderboard
 * to check: a score submitted without its log can never be verified
 * afterwards, however clever the server gets later. Capture is cheap, and it
 * is the one part of this that cannot be added retroactively.
 *
 * ---- the format ----
 *
 * The 15-byte seat payload specified in DESIGN.md §11c, little-endian, one per
 * tick. Deliberately the same layout the relay will want on the wire: two uses,
 * one encoder, and no chance of the two drifting into disagreeing about what a
 * tick is.
 *
 *   0  uint16  held      the BTN bitfield
 *   2  uint16  pressed   edges
 *   4  int8    mx        hundredths of a unit-or-less push
 *   5  int8    my
 *   6  int32   aimX      world px, rounded
 *  10  int32   aimY
 *  14  uint8   choice
 *
 * `aim` is int32 rather than int16 because a leg is now ~25 000 px at the far
 * end of a tunnel, close enough to int16's ±32 767 that the four bytes are not
 * worth the risk.
 *
 * Ten minutes of solo play is 36 000 ticks, 540 KB raw, and it compresses
 * hard because held inputs repeat for long stretches.
 */

export const SEAT_BYTES = 15;

/** how long a log may get before it stops growing, in ticks (~3 hours solo) */
const MAX_TICKS = 648_000;

export class InputLog {
  private buf: Uint8Array;
  private view: DataView;
  /** ticks recorded so far */
  private n = 0;
  /** dropped rather than grow without bound; a truncated log is marked, not silent */
  truncated = false;
  readonly seats: number;

  constructor(seats = 1, capacityTicks = 4096) {
    this.seats = seats;
    this.buf = new Uint8Array(capacityTicks * seats * SEAT_BYTES);
    this.view = new DataView(this.buf.buffer);
  }

  get ticks(): number {
    return this.n;
  }

  get bytes(): number {
    return this.n * this.seats * SEAT_BYTES;
  }

  private grow() {
    const next = new Uint8Array(this.buf.length * 2);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  /** one tick: every seat's input, in seat order */
  push(inputs: TickInput[]): void {
    if (this.n >= MAX_TICKS) {
      this.truncated = true;
      return;
    }
    if (this.bytes + this.seats * SEAT_BYTES > this.buf.length) this.grow();
    let o = this.bytes;
    for (let s = 0; s < this.seats; s++) {
      const i = inputs[s];
      if (!i) {
        o += SEAT_BYTES;
        continue;
      }
      this.view.setUint16(o, i.held & 0xffff, true);
      this.view.setUint16(o + 2, i.pressed & 0xffff, true);
      // hundredths: a push is a unit-or-less vector since the view turns it
      // (scenes/input.ts) and a stick can push halfway, as a bare int8 a
      // turned single key (0.7, 0.7) was logged as (0, 0): a replay stood still
      this.view.setInt8(o + 4, Math.round(i.mx * 100));
      this.view.setInt8(o + 5, Math.round(i.my * 100));
      this.view.setInt32(o + 6, Math.round(i.aimX), true);
      this.view.setInt32(o + 10, Math.round(i.aimY), true);
      this.view.setUint8(o + 14, i.choice & 0xff);
      o += SEAT_BYTES;
    }
    this.n += 1;
  }

  /** exactly the bytes written, with no spare capacity on the end */
  toBytes(): Uint8Array {
    return this.buf.slice(0, this.bytes);
  }

  /**
   * Back to inputs. The aim comes back ROUNDED, which is the one lossy step,
   * so a replay is bit-exact only if the live run also fed the simulation
   * rounded aim. `DemoScene.readControls` rounds for exactly this reason.
   */
  static decode(bytes: Uint8Array, seats = 1): TickInput[][] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ticks = Math.floor(bytes.byteLength / (seats * SEAT_BYTES));
    const out: TickInput[][] = [];
    for (let t = 0; t < ticks; t++) {
      const row: TickInput[] = [];
      for (let s = 0; s < seats; s++) {
        const o = (t * seats + s) * SEAT_BYTES;
        row.push({
          held: view.getUint16(o, true),
          pressed: view.getUint16(o + 2, true),
          mx: view.getInt8(o + 4) / 100,
          my: view.getInt8(o + 5) / 100,
          aimX: view.getInt32(o + 6, true),
          aimY: view.getInt32(o + 10, true),
          choice: view.getUint8(o + 14),
        });
      }
      out.push(row);
    }
    return out;
  }

  reset(): void {
    this.n = 0;
    this.truncated = false;
  }

  /** a recorded log back in, whole: what a resumed run continues from */
  load(bytes: Uint8Array): void {
    const ticks = Math.floor(bytes.byteLength / (this.seats * SEAT_BYTES));
    const need = ticks * this.seats * SEAT_BYTES;
    if (need > this.buf.length) {
      this.buf = new Uint8Array(Math.max(need, this.buf.length * 2));
      this.view = new DataView(this.buf.buffer);
    }
    this.buf.set(bytes.subarray(0, need));
    this.n = ticks;
    this.truncated = false;
  }
}

/**
 * Gzip, via the platform's own stream. Held inputs repeat for long stretches,
 * so this is not a marginal saving: a ten-minute solo run measures 527 KB
 * packed and **61 KB gzipped**, 81 KB once base64'd. That is what decides
 * where a log can live, under Firestore's 1 MB document limit with room to
 * spare, so a submission does not need separate blob storage.
 */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** base64, for putting a log in JSON without a second encoding to argue about */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  // chunked: String.fromCharCode(...bytes) blows the argument limit past ~100 KB
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
