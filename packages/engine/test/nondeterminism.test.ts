import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explore, exitCodeFor, formatExplore } from '../src/explorer.js';
import { loadScenario } from '../src/loader.js';
import { serializeReport } from '../src/report.js';
import { createSession, type Session } from '../src/runner.js';
import { testDsn } from './helpers.js';

const seeds = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seeds');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });
async function open(file: string) {
  const { scenario, dir } = await loadScenario(join(seeds, file));
  session = await createSession(scenario, { dsn, scenarioDir: dir });
  return session;
}
const confirmed = (r: Awaited<ReturnType<typeof explore>>) => r.violations.filter((v) => v.status === 'CONFIRMED');

describe('the serial oracle checks itself before exploring', () => {
  it('random data in the tables: oracle UNRELIABLE, ANOMALY findings suppressed, the invariant finding kept', async () => {
    const r = await explore(await open('random-data.mjs'), {});
    expect(r.oracle.status).toBe('unreliable');
    expect(r.oracle.reason).toMatch(/two serial runs/i);
    expect(r.violations.some((v) => v.kind === 'ANOMALY')).toBe(false);
    const v = confirmed(r).find((x) => x.invariant === 'both deposits counted');
    expect(v).toBeDefined();
    expect(v!.preemptions).toBe(1);
    expect(exitCodeFor(r)).toBe(1);
  });
  it('says so prominently in the text and in report.json', async () => {
    const r = await explore(await open('random-data.mjs'), {});
    const text = formatExplore(r);
    expect(text).toMatch(/^WARNING: the serial-equivalence oracle is UNRELIABLE for this scenario/m);
    expect(text).toMatch(/ANOMALY findings are suppressed/);
    expect(text).not.toMatch(/ANOMALY: serial-equivalence/);
    const j = JSON.parse(serializeReport(r));
    expect(j.oracle.status).toBe('unreliable');
    expect(j.oracle.reason.length).toBeGreaterThan(10);
  });
  it('random values returned by an actor count too', async () => {
    const r = await explore(await open('random-return.mjs'), {});
    expect(r.oracle.status).toBe('unreliable');
    expect(r.violations).toEqual([]);
    expect(exitCodeFor(r)).toBe(0);
  });
  it('safety net: a 0-preemption ANOMALY is never presented as a race; it demotes the oracle instead', async () => {
    const r = await explore(await open('random-when-first.mjs'), {});
    expect(r.oracle.status).toBe('unreliable');
    expect(r.oracle.reason).toMatch(/serial schedule/i);
    expect(r.violations.filter((v) => v.kind === 'ANOMALY')).toEqual([]);
    expect(exitCodeFor(r)).toBe(0);
  });
  it('stays OK for deterministic scenarios, for benign uuid/timestamp data listed in ignoreColumns, and is off when switched off', async () => {
    expect((await explore(await open('lost-update.mjs'), {})).oracle).toEqual({ status: 'ok' });
    await session!.close();
    session = undefined;
    expect((await explore(await open('benign-nondeterminism.mjs'), {})).oracle).toEqual({ status: 'ok' });
    await session!.close();
    session = undefined;
    expect((await explore(await open('lost-update-no-invariants.mjs'), { serialOracle: false })).oracle.status).toBe('off');
  });
  it('random statement parameters that do not change the data do not make the oracle unreliable (the statement-sequence warning covers them)', async () => {
    const r = await explore(await open('nondeterministic.mjs'), {});
    expect(r.oracle.status).toBe('ok');
    expect(confirmed(r).some((v) => v.kind === 'ANOMALY')).toBe(true);
  });
});
