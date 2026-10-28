import { readFileSync } from 'node:fs';
import { prefixChooser, serialChooser } from './choosers.js';
import type { Step } from './controller.js';
import { classify, type Hint } from './hints.js';
import { isSerializable, normalizeResult, outcomeKey, permutations, rejectedActors, RETRIABLE_CODES, type Outcome } from './oracles.js';
import type { Isolation, RunResult, Session } from './runner.js';
import { exploreBounded, exploreRandom, systemClock, type Clock, type StoppedBy } from './strategy.js';

export type FindingKind = 'VIOLATION' | 'ANOMALY';

export interface Finding {
  id: string;
  kind: FindingKind;
  invariant: string;
  detail?: string;
  /** CONFIRMED only when every replay reproduced it; anything else is UNCONFIRMED and does not count. */
  status: 'CONFIRMED' | 'UNCONFIRMED';
  confirmed: string;
  preemptions: number;
  /** 1-based position of the first schedule that showed it, in the deterministic exploration order. */
  scheduleIndex: number;
  /** Replayable schedule: the actor released at every decision. */
  schedule: string[];
  fingerprint: string;
  occurrences: number;
  timeline: Step[];
  hints: Hint[];
  warnings: string[];
}

export interface Coverage {
  explored: number;
  preemptionBound: number | null;
  exhaustiveWithinBound: boolean;
  stoppedBy: StoppedBy;
  strategy: 'dfs' | 'random';
  seed?: number;
  runs?: number;
  distinct?: number;
  serialReferenceRuns: number;
}

export interface ExploreStats {
  abortCodes: string[];
  blockedSeen: boolean;
  constraintErrors: boolean;
  violatingSchedules: number;
}

export interface ExploreReport {
  tool: 'interleave-pg';
  version: string;
  scenario: string;
  scenarioFile?: string;
  target: { host: string; port: number; db: string; isolation: Isolation };
  coverage: Coverage;
  oracles: string[];
  violations: Finding[];
  warnings: string[];
  /** Informational: not findings (for example an actor rejected by a UNIQUE constraint). */
  notes: string[];
  stats: ExploreStats;
  durationMs: number;
  exitCode: 0 | 1 | 4;
}

export interface ExploreRunOptions {
  maxPreemptions?: number;
  maxSchedules?: number;
  timeBudgetMs?: number;
  strategy?: 'dfs' | 'random';
  seed?: number;
  runs?: number;
  confirmRuns?: number;
  serialOracle?: boolean;
  clock?: Clock;
  scenarioFile?: string;
}

export const DEFAULTS = { maxPreemptions: 3, maxSchedules: 2000, timeBudgetMs: 120_000, confirmRuns: 3, runs: 100, seed: 1 };

function toolVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
}

/**
 * Exit code semantics (see docs/phase-2-report.md):
 *   1  at least one CONFIRMED finding, whatever stopped the search
 *   4  findings exist but none is confirmed (flaky): inconclusive
 *   0  no finding at all, including after a budget stop (the wording then says the search was not exhaustive)
 */
export function exitCodeFor(report: Pick<ExploreReport, 'violations'>): 0 | 1 | 4 {
  if (report.violations.some((v) => v.status === 'CONFIRMED')) return 1;
  if (report.violations.length > 0) return 4;
  return 0;
}

interface Candidate {
  kind: FindingKind;
  invariant: string;
  detail?: string;
}

export async function explore(session: Session, o: ExploreRunOptions): Promise<ExploreReport> {
  const sopts = session.scenario.options ?? {};
  const clock = o.clock ?? systemClock;
  const started = Date.now();
  const strategy = o.strategy ?? 'dfs';
  const maxPreemptions = o.maxPreemptions ?? sopts.maxPreemptions ?? DEFAULTS.maxPreemptions;
  const maxSchedules = o.maxSchedules ?? sopts.maxSchedules ?? DEFAULTS.maxSchedules;
  const timeBudgetMs = o.timeBudgetMs ?? DEFAULTS.timeBudgetMs;
  const confirmRuns = o.confirmRuns ?? DEFAULTS.confirmRuns;
  const useSerial = o.serialOracle ?? sopts.serialOracle ?? true;
  const { analyze, serialRuns } = createAnalyzer(session, useSerial);

  // ---- exploration -------------------------------------------------------------------------------------
  const found = new Map<string, Finding & { _hintsFrom: Step[] }>();
  const warnings = new Set<string>();
  const notes = new Set<string>();
  const stats: ExploreStats = { abortCodes: [], blockedSeen: false, constraintErrors: false, violatingSchedules: 0 };
  const aborts = new Set<string>();

  const onSchedule = async (info: { index: number; choices: string[]; preemptions: number }, r: RunResult) => {
    for (const w of r.warnings) warnings.add(w);
    for (const x of r.results) {
      if (x.error && (x.error.code === '23505' || x.error.code === '23P01') && !r.openTxnActors.includes(x.actor)) {
        notes.add(`actor ${x.actor} rejected by constraint ${x.error.constraint ? '"' + x.error.constraint + '"' : '(unnamed)'}; if the app does not handle this, users see an error`);
      }
    }
    for (const s of r.steps) {
      if (s.blockedBy) stats.blockedSeen = true;
      if (s.errorCode && RETRIABLE_CODES.has(s.errorCode)) aborts.add(s.errorCode);
      if (s.errorCode?.startsWith('23')) stats.constraintErrors = true;
    }
    const candidates = await analyze(r);
    if (candidates.length) stats.violatingSchedules++;
    for (const c of candidates) {
      const key = `${c.kind}:${c.invariant}`;
      const existing = found.get(key);
      if (existing) { existing.occurrences++; continue; }
      found.set(key, {
        id: `v${found.size + 1}`,
        kind: c.kind,
        invariant: c.invariant,
        ...(c.detail ? { detail: c.detail } : {}),
        status: 'UNCONFIRMED',
        confirmed: `0/${confirmRuns}`,
        preemptions: info.preemptions,
        scheduleIndex: info.index,
        schedule: info.choices,
        fingerprint: r.fingerprint,
        occurrences: 1,
        timeline: r.steps,
        hints: [],
        warnings: [],
        _hintsFrom: r.steps,
      });
    }
  };

  const exec = (chooser: Parameters<typeof session.execute>[0]['chooser']) => session.execute({ chooser, snapshot: useSerial });

  let coverage: Coverage;
  if (strategy === 'random') {
    const runs = o.runs ?? DEFAULTS.runs;
    const seed = o.seed ?? DEFAULTS.seed;
    const s = await exploreRandom(exec, { runs, seed, timeBudgetMs: o.timeBudgetMs }, clock, onSchedule);
    coverage = { explored: s.explored, preemptionBound: null, exhaustiveWithinBound: false, stoppedBy: s.stoppedBy, strategy: 'random', seed, runs, distinct: s.distinct, serialReferenceRuns: serialRuns() };
  } else {
    const s = await exploreBounded(exec, { maxPreemptions, maxSchedules, timeBudgetMs }, clock, onSchedule);
    coverage = { explored: s.explored, preemptionBound: maxPreemptions, exhaustiveWithinBound: s.exhaustive, stoppedBy: s.stoppedBy, strategy: 'dfs', serialReferenceRuns: serialRuns() };
  }
  coverage.serialReferenceRuns = serialRuns();
  stats.abortCodes = [...aborts].sort();

  // ---- confirmation: replay each finding's exact schedule `confirmRuns` times ---------------------------
  for (const f of found.values()) {
    let reproduced = 0;
    for (let i = 0; i < confirmRuns; i++) {
      const r = await session.execute({ chooser: prefixChooser(f.schedule), snapshot: useSerial });
      if (r.fingerprint !== f.fingerprint && !f.warnings.some((w) => w.startsWith('nondeterministic scenario: the statement'))) {
        f.warnings.push('nondeterministic scenario: the statement sequence (SQL + parameters) differed between the original run and a replay');
      }
      if (r.decisions.some((d) => d.diverged) && !f.warnings.some((w) => w.includes('diverged'))) {
        f.warnings.push('nondeterministic scenario: the replay diverged from the saved schedule');
      }
      const cands = await analyze(r);
      if (cands.some((c) => c.kind === f.kind && c.invariant === f.invariant)) reproduced++;
    }
    f.confirmed = `${reproduced}/${confirmRuns}`;
    f.status = reproduced === confirmRuns ? 'CONFIRMED' : 'UNCONFIRMED';
    f.hints = classify(f._hintsFrom);
  }

  const violations = [...found.values()].map(({ _hintsFrom, ...f }) => f as Finding);
  const report: ExploreReport = {
    tool: 'interleave-pg',
    version: toolVersion(),
    scenario: session.scenario.name,
    ...(o.scenarioFile ? { scenarioFile: o.scenarioFile } : {}),
    target: { host: session.target.host, port: session.target.port, db: session.target.database, isolation: session.isolation },
    coverage,
    oracles: ['invariants', ...(useSerial ? ['serial-equivalence'] : [])],
    violations,
    warnings: [...warnings].sort(),
    notes: [...notes].sort(),
    stats,
    durationMs: Date.now() - started,
    exitCode: 0,
  };
  report.exitCode = exitCodeFor(report);
  return report;
}

function toOutcome(r: RunResult): Outcome {
  return {
    snapshot: r.snapshotHash ?? '',
    results: Object.fromEntries(r.results.map((x) => [x.actor, normalizeResult(x)])),
  };
}

// ------------------------------------------------------------------------------------------------------
// Isolation matrix
// ------------------------------------------------------------------------------------------------------

export interface MatrixRow {
  isolation: 'rc' | 'rr' | 'ser';
  /** Confirmed findings: the level admits the anomaly. */
  admitted: number;
  /** Retriable aborts seen (40001 / 40P01): the database killed a transaction. */
  aborted: string[];
  /** Blocking or a constraint stopped it (and nothing was admitted). */
  prevented: ('blocking' | 'constraint')[];
  report: ExploreReport;
}

export async function exploreMatrix(open: (iso: 'rc' | 'rr' | 'ser') => Promise<Session>, o: ExploreRunOptions): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  for (const iso of ['rc', 'rr', 'ser'] as const) {
    const s = await open(iso);
    try {
      const report = await explore(s, o);
      const admitted = report.violations.filter((v) => v.status === 'CONFIRMED').length;
      const prevented: MatrixRow['prevented'] = [];
      if (admitted === 0) {
        if (report.stats.blockedSeen) prevented.push('blocking');
        if (report.stats.constraintErrors) prevented.push('constraint');
      }
      rows.push({ isolation: iso, admitted, aborted: report.stats.abortCodes, prevented, report });
    } finally {
      await s.close();
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------------
// Text output
// ------------------------------------------------------------------------------------------------------

const trunc = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 3) + '...' : one;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function coverageLine(c: Coverage): string {
  const bound = c.preemptionBound === null ? 'preemption bound n/a' : `preemption bound ${c.preemptionBound}`;
  const what =
    c.strategy === 'random' ? `${plural(c.explored, 'schedule')} (random, seed ${c.seed}, ${c.distinct} distinct)` : plural(c.explored, 'schedule');
  return `Coverage: explored ${what}, ${bound}, exhaustive within bound: ${c.exhaustiveWithinBound ? 'yes' : 'no'}, stopped by: ${c.stoppedBy}`;
}

export function formatExplore(r: ExploreReport): string {
  const out: string[] = [];
  out.push(`Scenario: ${r.scenario}`);
  out.push(`Target:   ${r.target.host}:${r.target.port}/${r.target.db}   isolation: ${r.target.isolation}`);
  out.push(`Strategy: ${r.coverage.strategy === 'dfs' ? 'iterative context bounding (0, 1, 2 ... preemptions), DFS' : `seeded random scheduling (seed ${r.coverage.seed})`}`);
  out.push(`Oracles:  ${r.oracles.join(', ')}`);
  for (const f of r.violations) {
    out.push('');
    const head = f.status === 'CONFIRMED' ? `CONFIRMED (${f.confirmed})` : `UNCONFIRMED (flaky) [${f.confirmed} replays reproduced it; not counted as a finding]`;
    out.push(`${head} ${f.kind}: ${f.invariant}${f.detail ? ' - ' + f.detail : ''}`);
    out.push(`  first seen at schedule #${f.scheduleIndex} with ${plural(f.preemptions, 'preemption')}; seen in ${plural(f.occurrences, 'schedule')} in total`);
    out.push(`  schedule: ${f.schedule.join(',')}`);
    out.push('   #  Actor Txn  SQL                                              Params          Result');
    for (const s of f.timeline) {
      const params = s.params && s.params.length ? trunc(JSON.stringify(s.params), 14) : '';
      out.push(`  ${String(s.step).padStart(2)}  ${s.actor.padEnd(5)} ${(s.txn ?? '-').padEnd(4)} ${trunc(s.sql, 48).padEnd(48)} ${params.padEnd(15)} ${trunc(s.result, 50)}`);
      if (s.blockedBy) out.push(`        ^ [BLOCKED] ${s.actor} waited on ${s.blockedBy.length ? s.blockedBy.join(', ') : 'another session'} before this statement completed`);
    }
    for (const h of f.hints) out.push(`  hint (heuristic): ${h.label}: ${h.detail}. Typical fix: ${h.fix}`);
    for (const w of f.warnings) out.push(`  warning: ${w}`);
  }
  for (const w of r.warnings) out.push(`warning: ${w}`);
  for (const n of r.notes) out.push(`note: ${n}`);
  out.push('');
  const c = r.coverage;
  const confirmedN = r.violations.filter((v) => v.status === 'CONFIRMED').length;
  if (r.violations.length === 0) {
    out.push(
      c.strategy === 'dfs'
        ? `No violations found in ${plural(c.explored, 'schedule')} (preemption bound ${c.preemptionBound}, exhaustive within bound: ${c.exhaustiveWithinBound ? 'yes' : 'no'})`
        : `No violations found in ${plural(c.explored, 'schedule')} (random scheduling, seed ${c.seed}, exhaustive within bound: no)`,
    );
  } else if (confirmedN === 0) {
    out.push(`Inconclusive: ${plural(r.violations.length, 'finding')} could not be reproduced 3 of 3 times, so none is reported as a violation.`);
  } else {
    out.push(`${plural(confirmedN, 'confirmed finding')} in ${plural(c.explored, 'schedule')} explored.`);
  }
  if (c.stoppedBy !== 'complete') out.push(`The search stopped early (${c.stoppedBy}); it is not exhaustive.`);
  out.push(coverageLine(c));
  return out.join('\n');
}

export function formatMatrix(rows: MatrixRow[]): string {
  const out: string[] = [];
  out.push(`Isolation matrix: ${rows[0]?.report.scenario ?? ''}`);
  out.push('(what the explored schedules showed per level; the app\'s own BEGIN ISOLATION LEVEL overrides the session level)');
  out.push('');
  out.push('level  admitted      aborted (retriable)   prevented by blocking/constraint');
  for (const r of rows) {
    out.push(
      `${r.isolation.padEnd(6)} ${(r.admitted ? `yes (${r.admitted})` : 'no').padEnd(13)} ${(r.aborted.length ? r.aborted.join(',') : '-').padEnd(21)} ${r.prevented.length ? r.prevented.join(', ') : '-'}`,
    );
  }
  out.push('');
  for (const r of rows) out.push(`${r.isolation}: ${coverageLine(r.report.coverage)}`);
  return out.join('\n');
}

/** Serial-equivalence + invariant analysis of one run. Serial reference outcomes are computed lazily and cached. */
export function createAnalyzer(session: Session, useSerial: boolean) {
  const reference = new Map<string, Set<string>>();
  let serialRuns = 0;
  const ensureReference = async (subset: string[]): Promise<void> => {
    const key = subset.join(',');
    if (reference.has(key)) return;
    const keys = new Set<string>();
    for (const order of permutations(subset)) {
      const r = await session.execute({ chooser: serialChooser(order), only: subset, invariants: false, snapshot: true });
      serialRuns++;
      keys.add(outcomeKey(toOutcome(r), subset));
    }
    reference.set(key, keys);
  };
  const analyze = async (r: RunResult): Promise<Candidate[]> => {
    const out: Candidate[] = r.violations.map((v) => ({ kind: 'VIOLATION' as const, invariant: v.invariant, detail: v.detail }));
    if (useSerial && r.snapshotHash) {
      const outcome = toOutcome(r);
      const aborted = rejectedActors(outcome.results, r.openTxnActors);
      const remaining = Object.keys(outcome.results).filter((a) => !aborted.includes(a)).sort();
      if (remaining.length > 0) await ensureReference(remaining);
      if (!isSerializable(outcome, (subset) => reference.get(subset.join(',')) ?? new Set(), r.openTxnActors)) {
        out.push({ kind: 'ANOMALY', invariant: 'serial-equivalence', detail: 'the outcome matches no serial execution of the actors' });
      }
    }
    return out;
  };
  return { analyze, serialRuns: () => serialRuns };
}

export interface ReplayTarget {
  schedule: string[];
  kind: FindingKind;
  invariant: string;
  fingerprint: string;
}
export interface ReplayResult {
  runs: number;
  reproduced: number;
  /** True when the statement sequence differs from the saved one (code changed, or a nondeterministic scenario). */
  fingerprintDiffers: boolean;
  diverged: boolean;
}

/** Re-run a saved schedule `runs` times and count how often the same finding shows up. */
export async function replayFinding(session: Session, t: ReplayTarget, runs: number, serialOracle?: boolean): Promise<ReplayResult> {
  const useSerial = serialOracle ?? session.scenario.options?.serialOracle ?? true;
  const { analyze } = createAnalyzer(session, useSerial);
  let reproduced = 0;
  let fingerprintDiffers = false;
  let diverged = false;
  for (let i = 0; i < runs; i++) {
    const r = await session.execute({ chooser: prefixChooser(t.schedule), snapshot: useSerial });
    if (r.fingerprint !== t.fingerprint) fingerprintDiffers = true;
    if (r.decisions.some((d) => d.diverged)) diverged = true;
    if ((await analyze(r)).some((c) => c.kind === t.kind && c.invariant === t.invariant)) reproduced++;
  }
  return { runs, reproduced, fingerprintDiffers, diverged };
}
