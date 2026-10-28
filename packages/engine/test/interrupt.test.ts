import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { onInterrupt } from '../src/interrupt.js';
import { cli, pkg, seed } from './cli-helpers.js';
import { adminDsn, testDsn } from './helpers.js';

describe('Ctrl-C handling (in process)', () => {
  const setup = () => {
    const proc = new EventEmitter();
    const exits: number[] = [];
    const log: string[] = [];
    return { proc, exits, log, exit: (c: number) => { exits.push(c); } };
  };
  it('runs the cleanup once, then exits with 130 for SIGINT and 143 for SIGTERM', async () => {
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      const s = setup();
      let cleaned = 0;
      onInterrupt(async () => { cleaned++; }, { proc: s.proc as any, exit: s.exit, write: (m) => s.log.push(m) });
      s.proc.emit(sig);
      s.proc.emit(sig); // a second signal while cleaning up exits at once
      await new Promise((r) => setTimeout(r, 30));
      expect(cleaned).toBe(1);
      expect(s.exits[0]).toBe(code === 130 ? 130 : 143);
      expect(s.log.join('')).toMatch(/interrupted/);
    }
  });
  it('a second signal exits immediately without waiting for a stuck cleanup', async () => {
    const s = setup();
    onInterrupt(() => new Promise(() => {}), { proc: s.proc as any, exit: s.exit, write: () => {}, graceMs: 60_000 });
    s.proc.emit('SIGINT');
    expect(s.exits).toEqual([]);
    s.proc.emit('SIGINT');
    expect(s.exits).toEqual([130]);
  });
  it('gives up on a cleanup that takes longer than the grace period', async () => {
    const s = setup();
    onInterrupt(() => new Promise(() => {}), { proc: s.proc as any, exit: s.exit, write: () => {}, graceMs: 50 });
    s.proc.emit('SIGINT');
    await new Promise((r) => setTimeout(r, 150));
    expect(s.exits).toEqual([130]);
  });
  it('dispose removes the handlers', () => {
    const s = setup();
    const dispose = onInterrupt(async () => {}, { proc: s.proc as any, exit: s.exit, write: () => {} });
    dispose();
    expect(s.proc.listenerCount('SIGINT')).toBe(0);
    expect(s.proc.listenerCount('SIGTERM')).toBe(0);
  });
});

// Node cannot deliver SIGINT to a child process on Windows (it terminates it without running handlers), so this
// test cannot run there. CI runs on Linux, where the "no skipped tests" rule makes a skip a failure.
const realSignal = process.platform === 'win32' ? it.skip : it;
if (process.platform === 'win32') console.warn('SKIPPED here: the real-signal Ctrl-C test cannot run on Windows (no SIGINT delivery to child processes); it runs on Linux CI.');

describe('Ctrl-C handling (real signal)', () => {
  let dsn: string;
  beforeAll(async () => { dsn = await testDsn(); });

  realSignal('SIGINT during a run: exits 130, rolls back, closes every connection, releases the lock', async () => {
    const child = spawn(process.execPath, [cli, 'run', seed('slow-txn.mjs'), '--max-schedules', '50'], {
      cwd: pkg,
      env: { ...process.env, INTERLEAVE_DSN: dsn, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const exited = new Promise<number | null>((res) => child.on('exit', (code) => res(code)));

    const watcher = new pg.Client(dsn);
    await watcher.connect();
    try {
      // Wait until the engine is really inside the transaction, sleeping.
      const deadline = Date.now() + 30_000;
      let inside = false;
      while (Date.now() < deadline && !inside) {
        const r = await watcher.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%interleave-slow%' AND state = 'active' AND pid <> pg_backend_pid()`);
        inside = r.rows[0].n > 0;
        if (!inside) await new Promise((r2) => setTimeout(r2, 50));
      }
      expect(inside, 'the scenario never reached the sleeping transaction').toBe(true);

      child.kill('SIGINT');
      const code = await Promise.race([exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 15_000))]);
      expect(code).toBe(130);
      expect(err).toMatch(/interrupted/i);

      // Nothing of ours is left behind: no other session in this database, no open transaction, advisory lock free.
      let left = -1;
      for (let i = 0; i < 40 && left !== 0; i++) {
        left = (await watcher.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows[0].n;
        if (left !== 0) await new Promise((r) => setTimeout(r, 50));
      }
      const rest = (await watcher.query(`SELECT pid, state, left(query, 60) AS query FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows;
      expect(left, `leftover sessions: ${JSON.stringify(rest)}`).toBe(0);
      const lock = await watcher.query(`SELECT pg_try_advisory_lock(hashtext('interleave-pg')) AS got`);
      expect(lock.rows[0].got).toBe(true);
      await watcher.query(`SELECT pg_advisory_unlock(hashtext('interleave-pg'))`);
      const bal = await watcher.query('SELECT balance FROM accounts WHERE id = 1');
      expect(bal.rows[0]?.balance ?? 100).toBe(100); // the uncommitted update was rolled back, never committed
    } finally {
      child.kill('SIGKILL');
      await watcher.end();
    }
  }, 60_000);
});
