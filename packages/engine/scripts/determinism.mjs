#!/usr/bin/env node
// Determinism check: explore every seed scenario N times with the built CLI and compare the results.
//   node scripts/determinism.mjs [--iterations N] [--stress]
// Per seed it records the counts and findings ("summary") and also hashes the whole JSON report ("full",
// which includes timelines). Exit code 1 if any iteration differs from the first.
// Test tooling only: it needs a local test database (INTERLEAVE_DSN, or INTERLEAVE_ADMIN_DSN to create one).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(pkg, 'dist', 'cli.js');
const args = process.argv.slice(2);
const iterations = Number(args[args.indexOf('--iterations') + 1] ?? 5) || 5;
const stress = args.includes('--stress');

const SEEDS = [
  ['lost-update.mjs'], ['check-then-insert.mjs'], ['oversell.mjs'], ['coupon.mjs'], ['write-skew.mjs'], ['deadlock.mjs'],
  ['two-preemptions.mjs'], ['lost-update-safe.mjs'], ['check-then-insert-safe.mjs'], ['oversell-safe.mjs'], ['coupon-safe.mjs'],
  ['write-skew-safe.mjs'], ['deadlock-safe.mjs'], ['benign-nondeterminism.mjs'], ['lost-update-no-invariants.mjs'], ['flaky.mjs'],
  ['explode.mjs', '--max-schedules', '30'],
];

function env() {
  const e = { ...process.env, NODE_ENV: 'test' };
  if (!e.INTERLEAVE_DSN) {
    if (!e.INTERLEAVE_ADMIN_DSN) throw new Error('set INTERLEAVE_DSN, or INTERLEAVE_ADMIN_DSN to create interleave_test');
    const r = spawnSync(process.execPath, [cli, 'init-db', '--name', 'interleave_test'], { env: { ...e, INTERLEAVE_DSN: e.INTERLEAVE_ADMIN_DSN }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('init-db failed: ' + r.stderr);
    const u = new URL(e.INTERLEAVE_ADMIN_DSN);
    u.pathname = '/interleave_test';
    e.INTERLEAVE_DSN = u.toString();
  }
  return e;
}

// Optional CPU stress: one busy-loop worker per core.
const burners = [];
if (stress) {
  const cores = (await import('node:os')).cpus().length;
  for (let i = 0; i < cores; i++) burners.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  console.log(`stress: ${cores} busy-loop processes running`);
}

const e = env();
mkdirSync(join(pkg, 'test', '.tmp', 'det'), { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const iterSummaries = [];
for (let i = 1; i <= iterations; i++) {
  const per = [];
  const fulls = [];
  const perFull = [];
  for (const [file, ...extra] of SEEDS) {
    const out = join('test', '.tmp', 'det', file.replace('.mjs', '.json'));
    const r = spawnSync(process.execPath, [cli, 'run', join('test', 'fixtures', 'seeds', file), '--json', out, ...extra], { cwd: pkg, env: e, encoding: 'utf8' });
    if (![0, 1, 4].includes(r.status)) throw new Error(`${file}: exit ${r.status}\n${r.stderr}`);
    const text = readFileSync(join(pkg, out), 'utf8');
    const j = JSON.parse(text);
    per.push({
      seed: file,
      exit: r.status,
      explored: j.coverage.explored,
      stoppedBy: j.coverage.stoppedBy,
      exhaustive: j.coverage.exhaustiveWithinBound,
      serialRuns: j.coverage.serialReferenceRuns,
      findings: j.violations.map((v) => [v.kind, v.invariant, v.status, v.confirmed, v.scheduleIndex, v.preemptions, v.occurrences, v.schedule.join('')]),
    });
    fulls.push(text);
    perFull.push([file, sha(text), text]);
  }
  const summary = sha(JSON.stringify(per));
  const full = sha(fulls.join('\n'));
  iterSummaries.push({ i, summary, full, per, perFull });
  console.log(`iteration ${String(i).padStart(2)}: summary=${summary} full=${full}  explored=[${per.map((p) => p.explored).join(',')}]`);
}
for (const b of burners) b.kill();

const first = iterSummaries[0];
const sameSummary = iterSummaries.every((x) => x.summary === first.summary);
const sameFull = iterSummaries.every((x) => x.full === first.full);
for (const x of iterSummaries.slice(1)) {
  const diff = x.perFull.filter(([f, h], k) => h !== first.perFull[k][1]).map(([f]) => f);
  if (diff.length) console.log('  iteration ' + x.i + ' differs from iteration 1 in the full report of: ' + diff.join(', '));
  for (const f of diff) {
    const a = first.perFull.find((p) => p[0] === f)[2].split('\n');
    const b = x.perFull.find((p) => p[0] === f)[2].split('\n');
    const k = a.findIndex((l, n) => l !== b[n]);
    console.log('    first differing line ' + (k + 1) + ':');
    console.log('      iteration 1: ' + a[k]);
    console.log('      iteration ' + x.i + ': ' + b[k]);
  }
}
console.log('');
console.log('per-seed result (identical in every iteration: ' + (sameSummary ? 'yes' : 'NO') + ')');
for (const p of first.per) {
  console.log(`  ${p.seed.padEnd(32)} exit=${p.exit} explored=${String(p.explored).padStart(3)} stoppedBy=${p.stoppedBy} findings=${p.findings.map((f) => `${f[0]}:${f[2]}@${f[4]}/p${f[5]}`).join(',') || '-'}`);
}
console.log('');
console.log(`${iterations} iterations: summary hashes identical in ${iterSummaries.filter((x) => x.summary === first.summary).length}/${iterations}; full-report hashes identical in ${iterSummaries.filter((x) => x.full === first.full).length}/${iterations}`);
process.exit(sameSummary && sameFull ? 0 : 1);
