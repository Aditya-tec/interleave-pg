import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Controller, type Step } from './controller.js';
import { NoStatementsError, ScenarioError } from './errors.js';
import { assertSafeTarget, redactDsn, type Target } from './guard.js';
import { installHook, newHookState, type Hook, type HookState } from './hook.js';
import { connectUnhooked, loadPg } from './pg-load.js';
import { validateScenario, type ActorResult, type Db, type ScenarioDefinition } from './scenario.js';

export interface SessionOptions {
  dsn: string;
  /** Directory of the scenario file: used to resolve `pg` and the `schema` path. */
  scenarioDir: string;
  stallTimeoutMs?: number;
  runTimeoutMs?: number;
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
}

export interface Violation {
  kind: 'VIOLATION';
  invariant: string;
  detail?: string;
}

export interface RunResult {
  scenario: string;
  schedule: string[];
  steps: Step[];
  results: ActorResult[];
  violations: Violation[];
  warnings: string[];
  durationMs: number;
  target: { host: string; port: number; database: string };
}

export interface Session {
  run(schedule: string[]): Promise<RunResult>;
  close(): Promise<void>;
}

const quoteIdent = (id: string) => '"' + id.replace(/"/g, '""') + '"';
const quoteTable = (t: string) => t.split('.').map(quoteIdent).join('.');
const ADVISORY_KEY = `hashtext('interleave-pg')`;

export async function createSession(input: ScenarioDefinition, opts: SessionOptions): Promise<Session> {
  const scenario = validateScenario(input);
  const stallTimeoutMs = opts.stallTimeoutMs ?? 3000;
  const runTimeoutMs = opts.runTimeoutMs ?? 30000;
  const settings = `SET statement_timeout = '${opts.statementTimeoutMs ?? 5000}ms'; SET lock_timeout = '${opts.lockTimeoutMs ?? 2000}ms'; SET idle_in_transaction_session_timeout = '30s'`;

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

  return {
    async run(schedule: string[]): Promise<RunResult> {
      const ids = Object.keys(scenario.actors);
      for (const s of schedule) {
        if (!ids.includes(s)) throw new ScenarioError(`unknown actor "${s}" in schedule (actors: ${ids.join(', ')})`);
      }
      const t0 = Date.now();
      await reset();
      state.unsafe = null;
      state.warnings.clear();
      state.untracked = 0;
      const controller = new Controller({
        schedule,
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
      const warnings = [...controller.warnings, ...state.warnings];
      const pids = [...state.clients].map((c) => c.processID).filter((p) => typeof p === 'number');
      if (pids.length) {
        const open = await control.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND state LIKE 'idle in transaction%'`,
          [pids],
        );
        if (open.rows[0].n > 0) warnings.push('transaction left open at the end of the run');
      }
      const violations = await evaluate(results);
      return {
        scenario: scenario.name,
        schedule,
        steps: controller.steps,
        results,
        violations,
        warnings,
        durationMs: Date.now() - t0,
        target: { host: target.host, port: target.port, database: target.database },
      };
    },
    close,
  };
}


