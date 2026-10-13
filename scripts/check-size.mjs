// No file over 350 lines. The split of 2026-09-03 took two files of 2,700
// and 2,300 lines apart; this keeps them apart.
//
//   node scripts/check-size.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 350;
const ROOTS = ['src', 'server'];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

let failed = 0;
let files = 0;
for (const root of ROOTS) {
  for (const file of walk(new URL('../' + root, import.meta.url).pathname)) {
    files += 1;
    const lines = readFileSync(file, 'utf8').split('\n').length;
    if (lines > LIMIT) {
      failed += 1;
      console.log(`  FAIL ${file.replace(/^.*\/(src|server)\//, '$1/')}: ${lines} lines (limit ${LIMIT})`);
    }
  }
}
console.log(`file sizes: ${files} files, ${failed} over ${LIMIT} lines`);
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
