// Stability proof: run each corpus set N times, normally and with every CPU core busy, and require identical outcomes
// and schedule counts in every run. Any difference is a bug to fix, not to retry.
//   INTERLEAVE_DSN=... node eval/stability.mjs --runs 20 --out eval/results/stability-<date>
// Each run is a separate `engine-metrics.js` process, so nothing carries over between runs. The comparison covers
// everything except wall-clock time: outcome, schedules explored, confirmed and unconfirmed findings, what stopped
// the search, and the observed preemption count.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const runs = Number(arg('runs', '20'));
const out = resolve(arg('out', join(here, 'results', 'stability')));
const sets = arg('sets', 'dev,heldout,heldout-human,hard').split(',');
mkdirSync(out, { recursive: true });

const run = (args) => new Promise((res, rej) => {
  const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}: ${args.join(' ')}`))));
});

const signature = (file) => {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return j.rows.map((r) => JSON.stringify([r.id, r.outcome, r.explored, r.confirmed, r.unconfirmed, r.stoppedBy, r.observedPreemptions ?? null])).join('\n');
};

/** One busy-loop process per core for the duration of fn. */
async function loaded(fn) {
  const burners = Array.from({ length: cpus().length }, () => spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }));
  try { return await fn(); } finally { for (const b of burners) b.kill(); }
}

const summary = [];
let bad = 0;
for (const mode of ['normal', 'loaded']) {
  for (const set of sets) {
    const once = async (i) => {
      const file = join(out, `${set}-${mode}-${String(i).padStart(2, '0')}.json`);
      await run([join(here, 'engine-metrics.js'), '--set', set, '--out', file]);
      return signature(file);
    };
    const exec = async () => { const s = []; for (let i = 1; i <= runs; i++) s.push(await once(i)); return s; };
    const t0 = Date.now();
    const sigs = mode === 'loaded' ? await loaded(exec) : await exec();
    const distinct = new Set(sigs);
    const rows = sigs[0].split('\n').length;
    if (distinct.size !== 1) {
      bad++;
      const base = sigs[0].split('\n');
      for (let i = 1; i < sigs.length; i++) {
        const cur = sigs[i].split('\n');
        base.forEach((l, k) => { if (l !== cur[k]) console.log(`DIFF ${set} ${mode} run ${i + 1} vs run 1:\n  ${l}\n  ${cur[k]}`); });
      }
    }
    const line = `${mode.padEnd(6)} ${set.padEnd(13)} ${runs} runs x ${rows} scenarios: ${distinct.size === 1 ? 'IDENTICAL' : `${distinct.size} DISTINCT RESULTS`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`;
    console.log(line);
    summary.push(line);
  }
}
writeFileSync(join(out, 'summary.txt'), summary.join('\n') + '\n');
console.log(bad === 0 ? 'ALL IDENTICAL' : `${bad} set/mode combinations differ`);
process.exit(bad === 0 ? 0 : 1);
