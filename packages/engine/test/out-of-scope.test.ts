import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, type Session } from '../src/runner.js';
import { explore, formatExplore, NOTICE_EXTERNAL_LOCKS } from '../src/explorer.js';
import { NoStatementsError, UnsupportedError } from '../src/errors.js';
import { loadScenario } from '../src/loader.js';
import { serializeReport } from '../src/report.js';
import { runCli, seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';

const seeds = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seeds');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });
const open = async (f: string) => {
  const { scenario, dir } = await loadScenario(join(seeds, f));
  session = await createSession(scenario, { dsn, scenarioDir: dir });
  return session;
};

describe('things the tool cannot see are said out loud', () => {
  it('a driver that bypasses the hook: explicit "cannot see" error, never a clean report', async () => {
    const err = await explore(await open('stub-driver.mjs'), {}).catch((e) => e);
    expect(err).toBeInstanceOf(NoStatementsError);
    expect(String(err.message)).toMatch(/no statements intercepted: pg resolution mismatch\?/);
    expect(String(err.message)).toMatch(/cannot see database calls that do not go through the app's pg package/);
  });
  it('the same through the CLI: exit 2 and the message on stderr', async () => {
    const r = await runCli(['run', seed('stub-driver.mjs')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/cannot see/);
    expect(r.out).not.toMatch(/No violations found/);
  });
  it('parallel statements inside one actor abort the run with UnsupportedError', async () => {
    const err = await explore(await open('parallel-statements.mjs'), {}).catch((e) => e);
    expect(err).toBeInstanceOf(UnsupportedError);
    expect(String(err.message)).toMatch(/parallel statements within one actor/);
    await session?.close();
    session = undefined;
    const r = await runCli(['run', seed('parallel-statements.mjs')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/UnsupportedError: parallel statements within one actor/);
    expect(r.out).not.toMatch(/No violations found/);
  });
  it('every finding carries the notice about locks held outside the database, in the text and in report.json', async () => {
    const report = await explore(await open('lost-update.mjs'), {});
    expect(NOTICE_EXTERNAL_LOCKS).toBe('This run cannot see locks held outside the database. If such a lock serializes these actors in production, this race may not occur there.');
    expect(report.violations.length).toBeGreaterThan(0);
    for (const v of report.violations) expect(v.notice).toBe(NOTICE_EXTERNAL_LOCKS);
    expect(formatExplore(report)).toContain(NOTICE_EXTERNAL_LOCKS);
    expect(JSON.parse(serializeReport(report)).violations[0].notice).toBe(NOTICE_EXTERNAL_LOCKS);
  });
});
