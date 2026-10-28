#!/usr/bin/env node
// Tree hash of the held-out set, so "committed before the final measurement" is checkable.
//   node eval/hash-heldout.mjs            print every file's sha256 and the tree hash
//   node eval/hash-heldout.mjs --verify <treeHash>   exit 1 if the set changed
// The hash covers corpus/heldout/** and the three shared helper modules those scenarios import.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(join(root, 'corpus', 'heldout'));
for (const f of ['lib.mjs', 'lib-knex.mjs', 'lib-drizzle.mjs']) files.push(join(root, 'corpus', '_lib', f));

const lines = files
  .map((p) => [relative(root, p).split(sep).join('/'), createHash('sha256').update(readFileSync(p).toString('utf8').replace(/\r\n/g, '\n')).digest('hex')])
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));
const tree = createHash('sha256').update(lines.map(([f, h]) => `${h}  ${f}`).join('\n')).digest('hex');

const i = process.argv.indexOf('--verify');
if (i >= 0) {
  const ok = process.argv[i + 1] === tree;
  console.log(ok ? `held-out set unchanged (${tree})` : `HELD-OUT SET CHANGED: expected ${process.argv[i + 1]}, now ${tree}`);
  process.exit(ok ? 0 : 1);
}
for (const [f, h] of lines) console.log(`${h}  ${f}`);
console.log(`\ntree sha256: ${tree}`);
console.log(`files: ${lines.length}`);
