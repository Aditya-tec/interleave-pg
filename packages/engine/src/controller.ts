import { als } from './actor-context.js';
import { StallError, UnsupportedError } from './errors.js';
import type { ActorResult } from './scenario.js';

export interface Stmt {
  sql: string;
  params?: unknown[];
}

export type Outcome = { ok: true; result: any } | { ok: false; error: any };

export interface Step {
  step: number;
  actor: string;
  txn: string | null;
  sql: string;
  params?: unknown[];
  result: string;
  errorCode?: string;
  blockedBy?: string[];
}

type Status = 'RUNNING' | 'AT_GATE' | 'IN_FLIGHT' | 'DONE';

interface Inflight {
  client: any;
  step: Step;
  polls: number;
}

interface Pending {
  client: any;
  stmt: Stmt;
  execute: () => Promise<Outcome>;
  resolve: (o: Outcome) => void;
}

class ActorState {
  status: Status = 'RUNNING';
  blocked = false;
  pending?: Pending;
  inflight?: Inflight;
  constructor(readonly id: string) {}
}

export interface ControllerOptions {
  schedule: string[];
  runId: number;
  stallTimeoutMs: number;
  runTimeoutMs: number;
  /** Runs once per client before its first gated statement (session timeouts etc.). */
  prepareClient: (client: any) => Promise<void>;
  /** Control connection used for pg_blocking_pids probes. */
  control: { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> };
  blockPollMs?: number;
}

const BEGIN_RE = /^\s*(begin|start\s+transaction)\b/i;
const END_RE = /^\s*(commit|end|rollback)\b(?!\s+(to|prepared))/i;

function summarize(r: any): string {
  if (!r || typeof r.rowCount !== 'number') return 'ok';
  const rows: any[] = Array.isArray(r.rows) ? r.rows : [];
  if (rows.length > 0) {
    const s = JSON.stringify(rows[0]);
    return `${rows.length} row${rows.length === 1 ? '' : 's'} ${s.length > 60 ? s.slice(0, 57) + '...' : s}`;
  }
  return r.command && /^(INSERT|UPDATE|DELETE)/.test(r.command) ? `${r.command} ${r.rowCount}` : `${r.rowCount} rows`;
}

export class Controller {
  readonly steps: Step[] = [];
  readonly warnings: string[] = [];
  readonly results = new Map<string, ActorResult>();
  private actors = new Map<string, ActorState>();
  private pidOwner = new Map<number, string>();
  private clientTxn = new WeakMap<object, string>();
  private txnCounter = 0;
  private waiters: (() => void)[] = [];
  private lastChange = Date.now();
  private cursor = 0;
  private lastPicked?: string;
  private aborted?: Error;

  constructor(private opts: ControllerOptions) {}

  private notify(): void {
    this.lastChange = Date.now();
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private waitForChange(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((f) => f !== onChange);
        resolve(false);
      }, ms);
      const onChange = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(onChange);
    });
  }

  /** Called by the hook for every statement issued inside an actor. */
  gate(actor: string, client: any, stmt: Stmt, execute: () => Promise<Outcome>): Promise<Outcome> {
    const st = this.actors.get(actor);
    if (!st) return Promise.resolve({ ok: false, error: new UnsupportedError(`statement from unknown actor "${actor}"`) });
    if (this.aborted) return Promise.resolve({ ok: false, error: this.aborted });
    if (st.status !== 'RUNNING') {
      return Promise.resolve({
        ok: false,
        error: new UnsupportedError(`UnsupportedError: parallel statements within one actor ("${actor}")`),
      });
    }
    return new Promise<Outcome>((resolve) => {
      st.pending = { client, stmt, execute, resolve };
      st.status = 'AT_GATE';
      this.notify();
    });
  }

  abort(err: Error): void {
    if (this.aborted) return;
    this.aborted = err;
    for (const st of this.actors.values()) {
      if (st.pending) {
        const p = st.pending;
        st.pending = undefined;
        st.status = 'RUNNING';
        p.resolve({ ok: false, error: err });
      }
    }
    this.notify();
  }

  /** Starts all actors and drives them to completion following the schedule. */
  async run(actorFns: Record<string, () => unknown>): Promise<void> {
    const ids = Object.keys(actorFns);
    for (const id of ids) this.actors.set(id, new ActorState(id));
    for (const id of ids) {
      const st = this.actors.get(id)!;
      const p = als.run({ actor: id, runId: this.opts.runId }, async () => actorFns[id]!());
      p.then(
        (value) => this.finish(st, { actor: id, status: 'fulfilled', value }),
        (e: any) => this.finish(st, { actor: id, status: 'rejected', error: { code: e?.code, message: String(e?.message ?? e) } }),
      );
    }
    const deadline = Date.now() + this.opts.runTimeoutMs;
    try {
      while ([...this.actors.values()].some((a) => a.status !== 'DONE')) {
        if (Date.now() > deadline) throw new Error(`run exceeded the wall-clock budget of ${this.opts.runTimeoutMs} ms`);
        await this.quiesce();
        if (this.aborted) throw this.aborted;
        const all = [...this.actors.values()];
        if (all.every((a) => a.status === 'DONE')) break;
        const runnable = all.filter((a) => a.status === 'AT_GATE').sort((a, b) => (a.id < b.id ? -1 : 1));
        if (runnable.length === 0) {
          await this.waitForChange(250);
          continue;
        }
        this.release(this.choose(runnable));
      }
    } catch (e) {
      this.abort(e as Error);
      // Let actors observe the abort and settle.
      const t = Date.now() + 2000;
      while ([...this.actors.values()].some((a) => a.status !== 'DONE') && Date.now() < t) await this.waitForChange(50);
      throw e;
    }
  }

  private finish(st: ActorState, r: ActorResult): void {
    this.results.set(st.id, r);
    st.status = 'DONE';
    this.notify();
  }

  private async quiesce(): Promise<void> {
    for (;;) {
      if (this.aborted) return;
      const all = [...this.actors.values()];
      const running = all.filter((a) => a.status === 'RUNNING');
      const unclassified = all.filter((a) => a.status === 'IN_FLIGHT' && !a.blocked);
      if (running.length === 0 && unclassified.length === 0) return;
      if (running.length > 0 && Date.now() - this.lastChange > this.opts.stallTimeoutMs) {
        throw new StallError(running[0]!.id);
      }
      if (unclassified.length > 0) {
        const changed = await this.waitForChange(this.opts.blockPollMs ?? 10);
        if (!changed) await this.pollBlocked(unclassified);
      } else {
        await this.waitForChange(Math.min(100, this.opts.stallTimeoutMs));
      }
    }
  }

  private async pollBlocked(list: ActorState[]): Promise<void> {
    const targets = list.filter((a) => a.inflight && typeof a.inflight.client.processID === 'number');
    if (targets.length === 0) return;
    const pids = targets.map((a) => a.inflight!.client.processID as number);
    const steps = targets.map((a) => a.inflight!.step);
    let rows: { pid: number; b: number[] }[];
    try {
      rows = (await this.opts.control.query('SELECT pid, pg_blocking_pids(pid) AS b FROM unnest($1::int[]) AS pid', [pids])).rows;
    } catch {
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i]!;
      // The statement may have completed while the probe was in flight.
      const inflight = a.inflight;
      if (a.status !== 'IN_FLIGHT' || !inflight || inflight.step !== steps[i]) continue;
      const row = rows.find((r) => r.pid === pids[i]);
      if (row && row.b.length > 0) {
        inflight.polls++;
        if (inflight.polls >= 2) {
          a.blocked = true;
          const owners = [...new Set(row.b.map((p) => this.pidOwner.get(p)).filter((x): x is string => !!x && x !== a.id))];
          inflight.step.blockedBy = owners;
          this.notify();
        }
      } else {
        inflight.polls = 0;
      }
    }
  }

  private choose(runnable: ActorState[]): ActorState {
    const { schedule } = this.opts;
    while (this.cursor < schedule.length) {
      const want = this.actors.get(schedule[this.cursor]!);
      if (!want) break;
      if (want.status === 'DONE') {
        this.warnings.push(`schedule entry ${this.cursor + 1} ("${want.id}") skipped: actor already finished`);
        this.cursor++;
        continue;
      }
      if (want.status === 'AT_GATE') {
        this.cursor++;
        this.lastPicked = want.id;
        return want;
      }
      break; // blocked or still in flight: use the default policy, keep the entry
    }
    const cont = this.lastPicked ? runnable.find((a) => a.id === this.lastPicked) : undefined;
    const pick = cont ?? runnable[0]!;
    this.lastPicked = pick.id;
    return pick;
  }

  private release(st: ActorState): void {
    const p = st.pending!;
    st.pending = undefined;
    st.status = 'IN_FLIGHT';
    st.blocked = false;
    const sql = p.stmt.sql;
    let txn = this.clientTxn.get(p.client) ?? null;
    if (BEGIN_RE.test(sql)) {
      txn = `T${++this.txnCounter}`;
      this.clientTxn.set(p.client, txn);
    }
    const step: Step = { step: this.steps.length + 1, actor: st.id, txn, sql, params: p.stmt.params, result: '...' };
    if (END_RE.test(sql)) this.clientTxn.delete(p.client);
    this.steps.push(step);
    if (typeof p.client.processID === 'number') this.pidOwner.set(p.client.processID, st.id);
    st.inflight = { client: p.client, step, polls: 0 };
    void (async () => {
      let outcome: Outcome;
      try {
        await this.opts.prepareClient(p.client);
        outcome = await p.execute();
      } catch (e) {
        outcome = { ok: false, error: e };
      }
      if (outcome.ok) step.result = summarize(outcome.result);
      else {
        const code = (outcome.error as any)?.code;
        if (code) step.errorCode = code;
        step.result = `ERROR${code ? ' ' + code : ''}: ${String((outcome.error as any)?.message ?? outcome.error).split('\n')[0]}`;
      }
      st.inflight = undefined;
      st.blocked = false;
      st.status = 'RUNNING';
      this.notify();
      p.resolve(outcome);
    })();
  }
}
