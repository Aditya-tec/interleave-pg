// Engine metrics over the corpus. Definitions are in docs/METRICS.md (committed before the first measurement).
//   npm run metrics -- --set dev [--out results.json] [--md results.md] [--only id,id]
// Needs INTERLEAVE_DSN (a local throwaway database created by `interleave-pg init-db`). Every connection goes
// through the engine's guard like any other run.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore, type ExploreReport } from '../packages/engine/dist/explorer.js';
import { loadScenario } from '../packages/engine/dist/loader.js';
import { createSession } from '../packages/engine/dist/runner.js';

interface Expected {
  id: string;
  expect: 'buggy' | 'safe' | 'unsupported';
  scope: 'in' | 'out';
  class?: string;
  driver?: string;
  invariant?: string;
  fix?: string;
  message?: string;
  notice?: string;
}

type Outcome = 'hit' | 'mismatch' | 'miss' | 'clean' | 'false-positive' | 'error' | 'limit-ok' | 'limit-fail';

interface Row {
  id: string;
  expect: Expected['expect'];
  scope: Expected['scope'];
  class?: string;
  driver?: string;
  expectedInvariant?: string;
  outcome: Outcome;
  explored: number | null;
  runtimeMs: number;
  stoppedBy?: string;
  confirmed: string[];
  unconfirmed: string[];
  error?: string;
  detail?: string;
}

const HARNESS_LIMIT_MS = 300_000;
const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, '..', 'corpus');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

function discover(set: string): { id: string; dir: string; expected: Expected }[] {
  const base = join(corpus, set);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((n) => !n.startsWith('_') && !n.startsWith('.'))
    .sort()
    .map((id) => ({ id, dir: join(base, id) }))
    .filter((e) => existsSync(join(e.dir, 'expected.json')) && existsSync(join(e.dir, 'scenario.mjs')))
    .map((e) => ({ ...e, expected: JSON.parse(readFileSync(join(e.dir, 'expected.json'), 'utf8')) as Expected }));
}

async function runOne(dsn: string, dir: string, expected: Expected, id: string): Promise<Row> {
  const row: Row = {
    id,
    expect: expected.expect,
    scope: expected.scope,
    class: expected.class,
    driver: expected.driver,
    expectedInvariant: expected.invariant,
    outcome: 'error',
    explored: null,
    runtimeMs: 0,
    confirmed: [],
    unconfirmed: [],
  };
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let report: ExploreReport | undefined;
  let session: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const { scenario, dir: scenarioDir } = await loadScenario(join(dir, 'scenario.mjs'));
    session = await createSession(scenario, { dsn, scenarioDir });
    const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`harness limit of ${HARNESS_LIMIT_MS / 1000} s exceeded`)), HARNESS_LIMIT_MS); });
    report = await Promise.race([explore(session, {}), limit]);
  } catch (e: any) {
    row.error = `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`;
  } finally {
    if (timer) clearTimeout(timer);
    row.runtimeMs = Date.now() - t0;
    await session?.close().catch(() => {});
  }

  if (report) {
    row.explored = report.coverage.explored;
    row.stoppedBy = report.coverage.stoppedBy;
    row.confirmed = report.violations.filter((v) => v.status === 'CONFIRMED').map((v) => `${v.kind}:${v.invariant}`);
    row.unconfirmed = report.violations.filter((v) => v.status !== 'CONFIRMED').map((v) => `${v.kind}:${v.invariant}`);
  }

  if (expected.scope === 'out') {
    // Honest limits: judged only on whether the tool said what its expected.json requires.
    let ok = false;
    if (expected.message) ok = !!row.error && new RegExp(expected.message).test(row.error);
    else if (expected.notice) {
      ok = !!report && report.violations.some((v) => v.status === 'CONFIRMED' && v.notice === expected.notice) && (!expected.invariant || row.confirmed.some((c) => c.endsWith(`:${expected.invariant}`)));
    }
    row.outcome = ok ? 'limit-ok' : 'limit-fail';
    return row;
  }
  if (expected.expect === 'buggy') {
    if (row.error) row.outcome = 'miss';
    else if (row.confirmed.some((c) => c.endsWith(`:${expected.invariant}`))) row.outcome = 'hit';
    else if (row.confirmed.length > 0) row.outcome = 'mismatch';
    else row.outcome = 'miss';
    if (row.outcome === 'mismatch') row.detail = `expected "${expected.invariant}", confirmed: ${row.confirmed.join('; ')}`;
  } else {
    if (row.error) row.outcome = 'error';
    else row.outcome = row.confirmed.length > 0 ? 'false-positive' : 'clean';
    if (row.outcome === 'false-positive') row.detail = row.confirmed.join('; ');
  }
  return row;
}

export interface Summary {
  set: string;
  scenarios: number;
  inScopeBuggy: number;
  hits: number;
  mismatches: number;
  misses: number;
  recall: number | null;
  inScopeSafe: number;
  falsePositives: number;
  safeErrors: number;
  fpRate: number | null;
  confirmedFindings: number;
  unconfirmedFindings: number;
  confirmationRate: number | null;
  exploredMedian: number | null;
  exploredP95: number | null;
  runtimeMedianMs: number | null;
  runtimeP95Ms: number | null;
  gates: Record<string, boolean | null>;
}

export function summarize(set: string, rows: Row[]): Summary {
  const inScope = rows.filter((r) => r.scope === 'in');
  const buggy = inScope.filter((r) => r.expect === 'buggy');
  const safe = inScope.filter((r) => r.expect === 'safe');
  const hits = buggy.filter((r) => r.outcome === 'hit').length;
  const fps = safe.filter((r) => r.outcome === 'false-positive').length;
  const confirmed = inScope.reduce((n, r) => n + r.confirmed.length, 0);
  const unconfirmed = inScope.reduce((n, r) => n + r.unconfirmed.length, 0);
  const explored = inScope.map((r) => r.explored).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const runtimes = inScope.map((r) => r.runtimeMs).sort((a, b) => a - b);
  const recall = buggy.length ? hits / buggy.length : null;
  const fpRate = safe.length ? fps / safe.length : null;
  const confirmationRate = confirmed + unconfirmed ? confirmed / (confirmed + unconfirmed) : null;
  const med = percentile(runtimes, 50);
  const p95 = percentile(runtimes, 95);
  return {
    set,
    scenarios: rows.length,
    inScopeBuggy: buggy.length,
    hits,
    mismatches: buggy.filter((r) => r.outcome === 'mismatch').length,
    misses: buggy.filter((r) => r.outcome === 'miss').length,
    recall,
    inScopeSafe: safe.length,
    falsePositives: fps,
    safeErrors: safe.filter((r) => r.outcome === 'error').length,
    fpRate,
    confirmedFindings: confirmed,
    unconfirmedFindings: unconfirmed,
    confirmationRate,
    exploredMedian: percentile(explored, 50),
    exploredP95: percentile(explored, 95),
    runtimeMedianMs: med,
    runtimeP95Ms: p95,
    gates: {
      'recall >= 90%': recall === null ? null : recall >= 0.9,
      'false positives == 0': fpRate === null ? null : fps === 0,
      'confirmation 100%': confirmationRate === null ? null : unconfirmed === 0,
      'runtime median <= 10 s': med === null ? null : med <= 10_000,
      'runtime p95 <= 60 s': p95 === null ? null : p95 <= 60_000,
    },
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const sec = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(2)} s`);

export function markdown(s: Summary, rows: Row[]): string {
  const out: string[] = [];
  out.push(`### Set \`${s.set}\`: ${s.scenarios} scenarios`);
  out.push('');
  out.push('| Metric | Value | Gate |');
  out.push('|---|---|---|');
  const g = (k: string) => (s.gates[k] === null ? 'n/a' : s.gates[k] ? 'PASS' : 'FAIL');
  out.push(`| Recall | ${pct(s.recall)} (${s.hits}/${s.inScopeBuggy} in-scope buggy; ${s.mismatches} mismatch, ${s.misses} miss) | ${g('recall >= 90%')} |`);
  out.push(`| False-positive rate | ${pct(s.fpRate)} (${s.falsePositives}/${s.inScopeSafe} in-scope safe; ${s.safeErrors} safe errors) | ${g('false positives == 0')} |`);
  out.push(`| Confirmation rate | ${pct(s.confirmationRate)} (${s.confirmedFindings} confirmed, ${s.unconfirmedFindings} unconfirmed) | ${g('confirmation 100%')} |`);
  out.push(`| Schedules explored | median ${s.exploredMedian ?? 'n/a'}, p95 ${s.exploredP95 ?? 'n/a'} | reported |`);
  out.push(`| Runtime | median ${sec(s.runtimeMedianMs)}, p95 ${sec(s.runtimeP95Ms)} (local, this machine) | ${g('runtime median <= 10 s')} / ${g('runtime p95 <= 60 s')} (official: CI job) |`);
  out.push('');
  out.push('| Scenario | Expected | Class | Driver | Outcome | Schedules | Runtime | Notes |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const note = r.error ?? r.detail ?? (r.unconfirmed.length ? `unconfirmed: ${r.unconfirmed.join('; ')}` : '');
    out.push(`| ${r.id} | ${r.expect}${r.scope === 'out' ? ' (out of scope)' : ''} | ${r.class ?? ''} | ${r.driver ?? ''} | ${r.outcome} | ${r.explored ?? '-'} | ${sec(r.runtimeMs)} | ${String(note).replace(/\|/g, '/').slice(0, 160)} |`);
  }
  return out.join('\n');
}

async function main() {
  const set = arg('set') ?? 'dev';
  const only = arg('only')?.split(',');
  const dsn = process.env.INTERLEAVE_DSN;
  if (!dsn) throw new Error('set INTERLEAVE_DSN to a local throwaway database (see `interleave-pg init-db`)');
  const found = discover(set).filter((e) => !only || only.includes(e.id));
  if (found.length === 0) throw new Error(`no scenarios found under corpus/${set} (a scenario directory needs scenario.mjs and expected.json)`);
  const rows: Row[] = [];
  for (const e of found) {
    const row = await runOne(dsn, e.dir, e.expected, e.id);
    rows.push(row);
    process.stderr.write(`${set}/${e.id}: ${row.outcome} (${row.explored ?? '-'} schedules, ${sec(row.runtimeMs)})\n`);
  }
  const summary = summarize(set, rows);
  const outPath = arg('out');
  if (outPath) {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
  }
  const mdPath = arg('md');
  const md = markdown(summary, rows);
  if (mdPath) writeFileSync(mdPath, md + '\n');
  process.stdout.write(md + '\n');
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`${e?.name ?? 'Error'}: ${e?.message ?? e}\n`);
    process.exit(2);
  });
}
