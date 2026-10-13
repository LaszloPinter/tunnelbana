/**
 * ONE STRING PER TUBE. A corridor joins two ROOMS (station and storey at
 * each end, core/corridor.ts), so anything remembered per corridor has to be
 * remembered per tube: keyed by the two names alone, the second tube between
 * a pair inherited the first one's traffic list, wall envelope and alcoves,
 * and so ran no trains and drew no rails (found in review, 2026-09-15).
 * A leaf on purpose: the caches that need it sit under corridor.ts itself.
 */
export function corridorKey(c: { a: string; b: string; la: number; lb: number }): string {
  return `${c.a}#${c.la}|${c.b}#${c.lb}`;
}
