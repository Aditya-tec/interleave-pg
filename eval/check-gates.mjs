#!/usr/bin/env node
// Applies the hard gates from docs/METRICS.md to a results file written by engine-metrics.
//   node eval/check-gates.mjs results.json [--runtime] [--every-scenario]
// Without --runtime only correctness gates are enforced (recall, false positives, confirmation, honest limits);
// with --runtime the runtime gates (median <= 10 s, p95 <= 60 s) are enforced too. --every-scenario is the regression check
// for a set whose every scenario is known to come out right (the adversarial dev set): any row that is not a hit, a clean
// safe scenario or a correct honest limit fails, however high recall still is (one miss of 14 is 92.9%, above the 90% gate).
// Exit 1 if any enforced gate fails.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: check-gates.mjs results.json [--runtime]');
const { summary, rows } = JSON.parse(readFileSync(file, 'utf8'));
const withRuntime = process.argv.includes('--runtime');
const everyScenario = process.argv.includes('--every-scenario');
const unexpected = rows.filter((r) => !['hit', 'clean', 'limit-ok'].includes(r.outcome)).map((r) => r.id);
const limitFails = rows.filter((r) => r.outcome === 'limit-fail').map((r) => r.id);
const checks = [
  ['recall >= 90%', summary.gates['recall >= 90%']],
  ['false positives == 0', summary.gates['false positives == 0']],
  ['confirmation 100%', summary.gates['confirmation 100%']],
  ['out-of-scope items say "cannot see / unsupported"', limitFails.length === 0],
  ['no tool errors on in-scope scenarios', rows.filter((r) => r.scope === 'in' && r.error).length === 0],
  ...(everyScenario ? [['every scenario came out as expected', unexpected.length === 0]] : []),
  ...(withRuntime ? [['runtime median <= 10 s', summary.gates['runtime median <= 10 s']], ['runtime p95 <= 60 s', summary.gates['runtime p95 <= 60 s']]] : []),
];
let failed = false;
for (const [name, ok] of checks) {
  console.log(`${ok === null ? 'N/A ' : ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok === false) failed = true;
}
if (everyScenario && unexpected.length) console.log(`scenarios not as expected: ${unexpected.join(', ')}`);
if (limitFails.length) console.log(`limit scenarios without the required message: ${limitFails.join(', ')}`);
console.log(`runtime (this job): median ${summary.runtimeMedianMs} ms, p95 ${summary.runtimeP95Ms} ms${withRuntime ? '' : ' (reported, not enforced here)'}`);
process.exit(failed ? 1 : 0);
