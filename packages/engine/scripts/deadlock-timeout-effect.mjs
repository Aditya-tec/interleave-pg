#!/usr/bin/env node
// Measures what deadlock_timeout costs and buys: for each value, the wall time to explore the deadlock seed, and
// how stable the victim is over 40 forced deadlocks with every core busy. Test tooling; needs INTERLEAVE_ADMIN_DSN.
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = (f) => import(pathToFileURL(join(pkg, 'dist', f)).href);
const { initDb } = await dist('initdb.js');
const { createSession } = await dist('runner.js');
const { explore } = await dist('explorer.js');
const { loadScenario } = await dist('loader.js');

const admin = process.env.INTERLEAVE_ADMIN_DSN;
if (!admin) throw new Error('set INTERLEAVE_ADMIN_DSN');
const values = (process.argv[2] ?? '50ms,100ms,150ms,200ms,300ms,500ms').split(',');
const { scenario, dir } = await loadScenario(join(pkg, 'test', 'fixtures', 'seeds', 'deadlock.mjs'));

const burners = [];
const startLoad = () => { for (let i = 0; i < cpus().length; i++) burners.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' })); };
const stopLoad = () => { for (const b of burners.splice(0)) b.kill(); };

console.log('deadlock_timeout | explore time (idle) | explored | victims over 40 forced deadlocks, idle | victims over 40, all cores busy');
for (const t of values) {
  const dsn = await initDb({ adminDsn: admin, name: 'interleave_test', deadlockTimeout: t });
  const victims = async () => {
    const s = await createSession(scenario, { dsn, scenarioDir: dir });
    const count = {};
    try {
      for (let i = 0; i < 40; i++) {
        const r = await s.run(['A', 'A', 'B', 'B', 'A', 'B']);
        const v = r.results.filter((x) => x.error?.code === '40P01').map((x) => x.actor).join(',') || 'none';
        count[v] = (count[v] ?? 0) + 1;
      }
    } finally {
      await s.close();
    }
    return JSON.stringify(count);
  };
  const s = await createSession(scenario, { dsn, scenarioDir: dir });
  const t0 = Date.now();
  const report = await explore(s, {});
  const ms = Date.now() - t0;
  await s.close();
  const idle = await victims();
  startLoad();
  await new Promise((r) => setTimeout(r, 500));
  const busy = await victims();
  stopLoad();
  console.log(`${t.padEnd(16)} | ${String(ms).padStart(6)} ms          | ${String(report.coverage.explored).padStart(3)}      | ${idle.padEnd(18)} | ${busy}`);
}
await initDb({ adminDsn: admin, name: 'interleave_test' });
process.exit(0);
