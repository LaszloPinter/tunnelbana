/** deterministic per-station rng so a station always looks the same */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// best-effort real-world flags: which line 18 stations are open-air
export const AD_COLORS = [0xc84c4c, 0x4c86c8, 0xc8b44c, 0x62b871, 0x9a6ac8, 0xd07a3c];

// fake-vintage copy until real public-domain scans (Spårvägsmuseet archive) land
// wide "movie screen" boards get one long line
export const WIDE_ADS: string[] = [
  'TRÄNA DIN TORRENT: IDAG',
  'SE SILVERPILEN: OM DEN SER DIG',
  'KYMLINGE: BESÖK ALDRIG',
  'MANA: NU FRÅN 20 KR/PACK',
  'DASH RESPONSIBLY',
  'BIO IKVÄLL · STORA SALONGEN',
  'VÄTTAR? RING 08-GRUVAN',
  'DRICK KAFFE. LITA INTE PÅ MÖRKRET.',
];

// vertical eurosize panels, five in a row, one word each
export const PANEL_WORDS: string[] = [
  'KAFFE',
  'LÄSK',
  'BIO',
  'MANA',
  'HÄLSA',
  'EXIT',
  'TÅG',
  'VÄTTE?',
  'DASH',
  'ARC',
];

export const AD_TEXTS: [string, string][] = [
  ['DRICK', 'KAFFE'],
  ['LÄSK', 'ISKALL'],
  ['BIO', 'IKVÄLL'],
  ['TANDKRÄM', 'VITT LEENDE'],
  ['HOTELL', 'CITY'],
  ['CHOKLAD', 'FINASTE'],
  ['RAKBLAD', 'SKARPA'],
  ['SEMLOR', 'NYBAKADE'],
];
