/**
 * A four-byte fingerprint of the simulation's state.
 *
 * This is what a lockstep room exchanges once a second: four clients that
 * arrive at the same number agree, by definition, on the whole game; one that
 * differs has desynced. It is also what the replay check compares, tick for
 * tick, to turn "the simulation is deterministic" from a belief into a test.
 *
 * It hashes the BITS of every number, not a rounding of them, lockstep needs
 * bit-identical state, and a fingerprint that forgave the last decimal would
 * hide exactly the drift it exists to catch. Maps, Sets, arrays and plain
 * objects are walked; object keys are sorted so insertion order cannot matter;
 * anything else (a function, a Phaser object) is a hashing ERROR, because it
 * means something that is not plain data has crept into the state.
 */

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

export class Fnv {
  private h = 0x811c9dc5;
  u32(v: number) {
    let h = this.h;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= v >>> 24;
    h = Math.imul(h, 0x01000193);
    this.h = h >>> 0;
  }
  num(v: number) {
    F64[0] = v;
    this.u32(U32[0]);
    this.u32(U32[1]);
  }
  str(s: string) {
    this.u32(s.length);
    for (let i = 0; i < s.length; i++) this.u32(s.charCodeAt(i));
  }
  get value(): number {
    return this.h >>> 0;
  }
}

export function hashValue(h: Fnv, v: unknown, path = ''): void {
  if (v === null || v === undefined) {
    h.u32(0x6e756c6c);
    return;
  }
  switch (typeof v) {
    case 'number':
      h.num(v);
      return;
    case 'boolean':
      h.u32(v ? 1 : 2);
      return;
    case 'string':
      h.str(v);
      return;
    case 'object':
      break;
    default:
      throw new Error(`fingerprint: ${typeof v} at ${path} is not simulation data`);
  }
  if (Array.isArray(v)) {
    h.u32(0xa0000000 + v.length);
    v.forEach((x, i) => hashValue(h, x, `${path}[${i}]`));
    return;
  }
  if (v instanceof Map) {
    h.u32(0xb0000000 + v.size);
    const keys = [...v.keys()].sort();
    for (const k of keys) {
      hashValue(h, k, `${path}.key`);
      hashValue(h, v.get(k), `${path}[${String(k)}]`);
    }
    return;
  }
  if (v instanceof Set) {
    h.u32(0xc0000000 + v.size);
    for (const k of [...v].sort()) hashValue(h, k, `${path}.set`);
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`fingerprint: a ${proto.constructor?.name ?? 'class'} at ${path} is not plain data`);
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  h.u32(0xd0000000 + keys.length);
  for (const k of keys) {
    h.str(k);
    hashValue(h, o[k], `${path}.${k}`);
  }
}

/** the fingerprint of a plain-data state */
export function fingerprint(state: unknown): number {
  const h = new Fnv();
  hashValue(h, state);
  return h.value;
}
