// Stability proof: run corpus sets repeatedly, normally and with the CPU busy, and require the same results in every
// run. Any difference is a bug to analyse, not to retry: the script stops at the first one. Criteria are in
// stability-compare.mjs (strict: every field; amended: schedule count and stop reason are skipped for time-budget stops).
//   INTERLEAVE_DSN=... node eval/stability.mjs --mode normal --plan dev:20:strict --out DIR
//   INTERLEAVE_DSN=... node eval/stability.mjs --mode loaded --load 10 --budget-min 180 --out DIR \
//       --plan hard:10:strict:1800s,heldout:20:amended,heldout-human:20:amended,dev:10:amended
// plan entry = set:runs:criterion[:time-budget]. Each run is a separate `engine-metrics.js` process. Before the busy
// loops start, every set is run once on the quiet machine (with the same time budget) as the baseline for its loaded
// runs; the baseline is also checked against the first run of the earlier normal pass (without the field added later).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffRows } from './stability-compare.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const mode = arg('mode', 'normal');
const load = mode === 'loaded' ? Number(arg('load', String(cpus().length))) : 0;
const plan = arg('plan', 'dev:20:strict,heldout:20:strict,heldout-human:20:strict,hard:20:strict').split(',').map((p) => { const [set, n, criterion = 'strict', tb] = p.split(':'); return { set, n: Number(n), criterion, tb }; });
const budgetMs = arg('budget-min') ? Number(arg('budget-min')) * 60_000 : Infinity;
const out = resolve(arg('out', join(here, 'results', 'stability')));
mkdirSync(out, { recursive: true });
let deadline = Infinity;

let current = null;
const run = (set, file, tb) => new Promise((res, rej) => {
  const args = [join(here, 'engine-metrics.js'), '--set', set, '--out', file, ...(tb ? ['--time-budget', tb] : [])];
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  current = p;
  const timer = deadline === Infinity ? null : setTimeout(() => { p.kill(); }, Math.max(1, deadline - Date.now()));
  p.on('exit', (c, sig) => { if (timer) clearTimeout(timer); current = null; if (sig) rej(new Error('budget')); else c === 0 ? res() : rej(new Error(`exit ${c}`)); });
});
const rowsOf = (file) => JSON.parse(readFileSync(file, 'utf8')).rows;

let burners = [];
const stopLoad = () => { for (const b of burners) b.kill(); };
process.on('exit', stopLoad);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { current?.kill(); stopLoad(); process.exit(130); });

const log = (s) => { console.log(s); appendFileSync(join(out, `summary-${mode}.txt`), s + '\n'); };
log(`mode=${mode} load=${load} busy loops on ${cpus().length} cores, time box ${budgetMs === Infinity ? 'none' : budgetMs / 60000 + ' min'}`);
log(`plan: ${plan.map((p) => `${p.set} x${p.n} ${p.criterion}${p.tb ? ' budget ' + p.tb : ''}`).join('; ')}`);

const baselines = new Map();
if (mode === 'loaded') {
  // quiet-machine baseline for every set, with the same options as its loaded runs
  for (const { set, tb } of plan) {
    const file = join(out, `${set}-baseline.json`);
    await run(set, file, tb);
    baselines.set(set, rowsOf(file));
    const old = join(out, `${set}-normal-01.json`);
    if (existsSync(old)) {
      const oldRows = rowsOf(old).map((r) => ({ ...r, firstViolationIndex: undefined }));
      const base = rowsOf(file).map((r) => ({ ...r, firstViolationIndex: undefined }));
      const d = diffRows(oldRows, base, 'amended');
      log(`baseline ${set}: ${d.differences.length === 0 ? 'matches the earlier normal pass' : 'DIFFERS from the earlier normal pass: ' + d.differences.map((x) => x.id).join(', ')}`);
      if (d.differences.length) { log('STOPPED: a difference was found'); process.exit(1); }
    }
  }
  burners = Array.from({ length: load }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  log(`busy loops started ${new Date().toISOString()}`);
}
deadline = Date.now() + budgetMs;

let different = false;
outer: for (const { set, n, criterion, tb } of plan) {
  const base = baselines.get(set) ?? (existsSync(join(out, `${set}-${mode}-01.json`)) ? null : null);
  let done = 0, ref = base;
  const t0 = Date.now();
  for (let i = 1; i <= n; i++) {
    if (Date.now() >= deadline) break;
    const file = join(out, `${set}-${mode}-${String(i).padStart(2, '0')}.json`);
    try { await run(set, file, tb); } catch (e) { if (e.message === 'budget') break; throw e; }
    const rows = rowsOf(file);
    ref ??= rows; // normal mode: the first run is the reference
    const d = diffRows(ref, rows, criterion);
    if (d.timeBudgetStops.length) log(`  ${set} run ${i}: stopped by time budget: ${d.timeBudgetStops.map((s) => `${s.id} (${s.explored} schedules)`).join(', ')}`);
    if (d.differences.length) {
      different = true;
      log(`DIFFERENCE in ${set} ${mode} run ${i} (${criterion}):`);
      for (const x of d.differences) log(`  ${x.id}\n    expected ${x.expected}\n    got      ${x.got}`);
      break outer;
    }
    done++;
  }
  log(`${mode.padEnd(6)} ${set.padEnd(13)} ${done} of ${n} runs completed (${criterion}), no differences (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
log(different ? 'STOPPED: a difference was found' : `finished ${new Date().toISOString()}${Date.now() >= deadline ? ' (time box reached)' : ''}`);
process.exit(different ? 1 : 0);
