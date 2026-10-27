import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forcedChooser, type Chooser, type Decision } from './choosers.js';
import { Controller, type Step } from './controller.js';
import { NoStatementsError, ScenarioError } from './errors.js';
import { assertSafeTarget, redactDsn, type Target } from './guard.js';
import { installHook, newHookState, type Hook, type HookState } from './hook.js';
import { connectUnhooked, loadPg } from './pg-load.js';
import { hashSnapshot, takeSnapshot } from './oracles.js';
import { quoteTable } from './sql.js';
import { validateScenario, type ActorResult, type Db, type ScenarioDefinition } from './scenario.js';

export interface SessionOptions {
  dsn: string;
  /** Directory of the scenario file: used to resolve `pg` and the `schema` path. */
  scenarioDir: string;
  stallTimeoutMs?: number;
  runTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  /** Isolation level applied to every new connection with SET SESSION CHARACTERISTICS (apps that BEGIN ISOLATION LEVEL themselves override it). */
  isolation?: Isolation;
}

export type Isolation = 'default' | 'rc' | 'rr' | 'ser';
const ISOLATION_SQL: Record<Exclude<Isolation, 'default'>, string> = {
  rc: 'READ COMMITTED',
  rr: 'REPEATABLE READ',
  ser: 'SERIALIZABLE',
};

export interface Violation {
  kind: 'VIOLATION';
  invariant: string;
  detail?: string;
}

export interface RunResult {
  scenario: string;
  schedule: string[];
  /** One entry per scheduling decision (runnable set, choice, preemption flag). */
  decisions: Decision[];
  /** The chosen actor at every decision: the saved, replayable schedule. */
  choices: string[];
  /** sha256 of the normalized statement sequence (actor, SQL, params). */
  fingerprint: string;
  /** Canonical hash of the final database snapshot (only when requested). */
  snapshotHash?: string;
  steps: Step[];
  results: ActorResult[];
  violations: Violation[];
  warnings: string[];
  durationMs: number;
  target: { host: string; port: number; database: string };
}

export interface ExecuteOptions {
  chooser: Chooser;
  /** Evaluate the scenario's invariants (default true). */
  invariants?: boolean;
  /** Compute the canonical snapshot hash of the tables (default false). */
  snapshot?: boolean;
  /** Run only these actors (used for serial reference runs of a subset). */
  only?: string[];
  /** Label stored in `schedule` (default: the chosen actors). */
  label?: string[];
}

export interface Session {
  run(schedule: string[]): Promise<RunResult>;
  execute(opts: ExecuteOptions): Promise<RunResult>;
  actorIds: string[];
  scenario: ScenarioDefinition;
  target: Target;
  isolation: Isolation;
  close(): Promise<void>;
}



const ADVISORY_KEY = `hashtext('interleave-pg')`;

export async function createSession(input: ScenarioDefinition, opts: SessionOptions): Promise<Session> {
  const scenario = validateScenario(input);
  const stallTimeoutMs = opts.stallTimeoutMs ?? 3000;
  const runTimeoutMs = opts.runTimeoutMs ?? 30000;
  const isolation: Isolation = opts.isolation ?? 'default';
  const isolationSql = isolation === 'default' ? '' : `; SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL ${ISOLATION_SQL[isolation]}`;
  const settings = `SET statement_timeout = '${opts.statementTimeoutMs ?? 5000}ms'; SET lock_timeout = '${opts.lockTimeoutMs ?? 2000}ms'; SET idle_in_transaction_session_timeout = '30s'${isolationSql}`;

  const pg = loadPg(opts.scenarioDir);
  const target: Target = await assertSafeTarget(opts.dsn, { connect: (t) => connectUnhooked(pg, t) });
  const control = await connectUnhooked(pg, target);
  const db: Db = { query: (sql, values) => control.query(sql, values as any[]) };
  const state: HookState = newHookState(target);
  let hook: Hook | undefined;
  let runId = 0;
  let ctx: any = {};
  let closed = false;

  const rollbackTracked = async () => {
    await Promise.all(
      [...state.clients].map((c) =>
        Promise.race([
          Promise.resolve(hook!.original.call(c, 'ROLLBACK')).catch(() => {}),
          new Promise((r) => setTimeout(r, 1000)),
        ]),
      ),
    );
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    try { if (hook) await rollbackTracked(); } catch { /* ignore */ }
    for (const c of state.clients) { try { await c.end(); } catch { /* ignore */ } }
    hook?.uninstall();
    try { await control.query(`SELECT pg_advisory_unlock(${ADVISORY_KEY})`); } catch { /* ignore */ }
    try { await control.end(); } catch { /* ignore */ }
  };

  try {
    // Edge case 17: one interleave-pg run per database at a time.
    let locked = false;
    for (let i = 0; i < 20 && !locked; i++) {
      locked = (await control.query(`SELECT pg_try_advisory_lock(${ADVISORY_KEY}) AS l`)).rows[0].l === true;
      if (!locked) await new Promise((r) => setTimeout(r, 50));
    }
    if (!locked) throw new ScenarioError(`another interleave-pg run is using ${redactDsn(opts.dsn)}`);

    hook = installHook(pg, state);
    if (scenario.schema) {
      const file = resolve(opts.scenarioDir, scenario.schema);
      await control.query(readFileSync(file, 'utf8'));
    }
    ctx = scenario.setup ? await scenario.setup({ dsn: opts.dsn }) : {};
    if (state.unsafe) throw state.unsafe;
  } catch (e) {
    await close();
    throw e;
  }

  const reset = async () => {
    await rollbackTracked();
    if (scenario.tables.length) {
      await control.query(`TRUNCATE ${scenario.tables.map(quoteTable).join(', ')} RESTART IDENTITY CASCADE`);
    }
    await scenario.seed?.(db);
  };

  const evaluate = async (results: ActorResult[]): Promise<Violation[]> => {
    const out: Violation[] = [];
    for (const inv of scenario.invariants ?? []) {
      let ok: boolean;
      let detail: string | undefined;
      try {
        if ('sql' in inv) {
          const r = await control.query(inv.sql);
          const row = r.rows[0];
          ok = !!row && row[Object.keys(row)[0]!] === true;
          if (!row) detail = 'invariant query returned no rows';
        } else {
          const r = await inv.js({ results, db });
          ok = r.ok === true;
          detail = r.detail;
        }
      } catch (e: any) {
        throw new ScenarioError(`invariant "${inv.name}" failed to evaluate: ${e?.message ?? e}`);
      }
      if (!ok) out.push({ kind: 'VIOLATION', invariant: inv.name, ...(detail ? { detail } : {}) });
    }
    return out;
  };

  const snapshotHash = async (): Promise<string> => hashSnapshot(await takeSnapshot(control, scenario.tables, scenario.options?.ignoreColumns ?? []));

  const execute = async (xo: ExecuteOptions): Promise<RunResult> => {
    const ids = xo.only ?? Object.keys(scenario.actors);
    const t0 = Date.now();
    await reset();
    state.unsafe = null;
    state.warnings.clear();
    state.untracked = 0;
    const warnings: string[] = [];
    const controller = new Controller({
      chooser: xo.chooser,
      runId: ++runId,
      stallTimeoutMs,
      runTimeoutMs,
      prepareClient: (c) => hook!.prepareClient(c, settings),
      control,
    });
    state.controller = controller;
    const fns: Record<string, () => unknown> = {};
    for (const id of ids) fns[id] = () => scenario.actors[id]!(ctx);
    try {
      await controller.run(fns);
    } finally {
      state.controller = null;
    }
    if (state.unsafe) throw state.unsafe;
    if (controller.steps.length === 0) throw new NoStatementsError();

    const results = ids.map((id) => controller.results.get(id)!);
    warnings.push(...controller.warnings, ...state.warnings);
    const pids = [...state.clients].map((c) => c.processID).filter((p) => typeof p === 'number');
    if (pids.length) {
      const open = await control.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND state LIKE 'idle in transaction%'`,
        [pids],
      );
      if (open.rows[0].n > 0) warnings.push('transaction left open at the end of the run');
    }
    const violations = xo.invariants === false ? [] : await evaluate(results);
    const choices = controller.decisions.map((d) => d.chosen);
    return {
      scenario: scenario.name,
      schedule: xo.label ?? choices,
      decisions: controller.decisions,
      choices,
      fingerprint: createHash('sha256').update(controller.steps.map((st) => `${st.actor}|${st.sql}|${JSON.stringify(st.params ?? null)}`).join('\n')).digest('hex'),
      ...(xo.snapshot ? { snapshotHash: await snapshotHash() } : {}),
      steps: controller.steps,
      results,
      violations,
      warnings,
      durationMs: Date.now() - t0,
      target: { host: target.host, port: target.port, database: target.database },
    };
  };

  return {
    async run(schedule: string[]): Promise<RunResult> {
      const ids = Object.keys(scenario.actors);
      for (const entry of schedule) {
        if (!ids.includes(entry)) throw new ScenarioError(`unknown actor "${entry}" in schedule (actors: ${ids.join(', ')})`);
      }
      const warn: string[] = [];
      const r = await execute({ chooser: forcedChooser(schedule, (m) => warn.push(m)), label: schedule });
      r.warnings.push(...warn);
      return r;
    },
    execute,
    actorIds: Object.keys(scenario.actors),
    scenario,
    target,
    isolation,
    close,
  };
}


