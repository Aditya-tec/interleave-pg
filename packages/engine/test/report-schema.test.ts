import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../src/json-schema.js';
import { explore } from '../src/explorer.js';
import { loadScenario } from '../src/loader.js';
import { parseReport, reportSchema, serializeReport } from '../src/report.js';
import { createSession, type Session } from '../src/runner.js';
import { pkg, runCli, seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';
import { join as pjoin } from 'node:path';

const seeds = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'seeds');
let dsn: string;
let session: Session | undefined;
beforeAll(async () => { dsn = await testDsn(); });
afterEach(async () => { await session?.close(); session = undefined; });
async function reportOf(file: string) {
  const { scenario, dir } = await loadScenario(join(seeds, file));
  session = await createSession(scenario, { dsn, scenarioDir: dir });
  return explore(session, {});
}

describe('the JSON Schema subset validator', () => {
  const v = (schema: object, value: unknown) => validateAgainstSchema(schema as any, value);
  it('type, enum, const, required, properties, items, pattern, bounds', () => {
    expect(v({ type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 0, maximum: 5 } } }, { a: 3 })).toEqual([]);
    expect(v({ type: 'object', required: ['a'] }, {})[0]).toMatch(/^\$: missing required property "a"/);
    expect(v({ properties: { a: { type: 'integer' } } }, { a: 1.5 })[0]).toMatch(/^\$\.a: expected integer/);
    expect(v({ properties: { a: { enum: ['x', 'y'] } } }, { a: 'z' })[0]).toMatch(/must be one of/);
    expect(v({ const: 1 }, 2)[0]).toMatch(/must equal 1/);
    expect(v({ type: 'array', items: { type: 'string', pattern: '^[a-z]+$' }, maxItems: 2 }, ['ab', 'C'])[0]).toMatch(/^\$\[1\]: does not match/);
    expect(v({ type: 'array', maxItems: 1 }, [1, 2])[0]).toMatch(/at most 1 items/);
    expect(v({ type: 'string', minLength: 2, maxLength: 3 }, 'abcd')[0]).toMatch(/at most 3 characters/);
    expect(v({ type: ['string', 'null'] }, null)).toEqual([]);
    expect(v({ type: 'number' }, 'x')[0]).toMatch(/expected number/);
  });
});

describe('report.json', () => {
  it('a real report validates against the published schema, and carries schemaVersion 1 and the oracle status', async () => {
    const r = await reportOf('lost-update.mjs');
    const j = JSON.parse(serializeReport(r));
    expect(j.schemaVersion).toBe(1);
    expect(j.oracle).toEqual({ status: 'ok' });
    expect(validateAgainstSchema(reportSchema(), j)).toEqual([]);
  });
  it('the schema file in the package is the one the validator uses, and is a valid JSON document with the expected shape', () => {
    const file = JSON.parse(readFileSync(join(pkg, 'schema', 'report.schema.json'), 'utf8'));
    expect(file.$schema).toMatch(/json-schema\.org/);
    expect(file.required).toEqual(expect.arrayContaining(['schemaVersion', 'tool', 'scenario', 'coverage', 'oracle', 'violations', 'exitCode']));
    expect(reportSchema()).toEqual(file);
  });
  it('mutated reports are rejected with the path of the problem', async () => {
    const j = JSON.parse(serializeReport(await reportOf('lost-update.mjs')));
    const bad = (mutate: (x: any) => void) => {
      const c = structuredClone(j);
      mutate(c);
      return validateAgainstSchema(reportSchema(), c);
    };
    expect(bad((x) => { x.exitCode = 7; })[0]).toMatch(/^\$\.exitCode/);
    expect(bad((x) => { x.violations[0].kind = 'EXPLOIT'; })[0]).toMatch(/^\$\.violations\[0\]\.kind/);
    expect(bad((x) => { x.violations[0].schedule = 'A,B'; })[0]).toMatch(/^\$\.violations\[0\]\.schedule: expected array/);
    expect(bad((x) => { delete x.oracle; })[0]).toMatch(/missing required property "oracle"/);
    expect(bad((x) => { x.coverage.stoppedBy = 'because'; })[0]).toMatch(/^\$\.coverage\.stoppedBy/);
  });
  it('a report that would not validate is never written (the writer checks itself)', async () => {
    const r = await reportOf('lost-update.mjs');
    (r as any).exitCode = 9;
    expect(() => serializeReport(r)).toThrow(/internal error: the report does not match its schema/);
  });
});

describe('replay checks the schema version', () => {
  const base = JSON.stringify({
    tool: 'interleave-pg', version: '0', scenario: 'x', scenarioFile: 'x.mjs', target: { isolation: 'default' },
    violations: [{ id: 'v1', kind: 'VIOLATION', invariant: 'i', status: 'CONFIRMED', schedule: ['A', 'B'], fingerprint: 'a'.repeat(64) }],
  });
  const withVersion = (v: unknown) => JSON.stringify({ ...JSON.parse(base), ...(v === undefined ? {} : { schemaVersion: v }) });
  it('accepts 1', () => { expect(parseReport(withVersion(1)).violations).toHaveLength(1); });
  it('rejects an unknown version with a clear message', () => {
    expect(() => parseReport(withVersion(2))).toThrow(/unsupported report schemaVersion 2 \(this version of interleave-pg reads schemaVersion 1\)/);
    expect(() => parseReport(withVersion('1'))).toThrow(/unsupported report schemaVersion/);
  });
  it('rejects a report with no version, saying it was written by an older version', () => {
    expect(() => parseReport(withVersion(undefined))).toThrow(/has no schemaVersion; it was written by an older interleave-pg/);
  });
  it('through the CLI: exit 2 and the message on stderr', async () => {
    const out = pjoin('test', '.tmp', 'schema-version.json');
    expect((await runCli(['run', seed('lost-update.mjs'), '--json', out])).code).toBe(1);
    const { readFileSync: rf, writeFileSync: wf } = await import('node:fs');
    const j = JSON.parse(rf(join(pkg, out), 'utf8'));
    j.schemaVersion = 99;
    wf(join(pkg, 'test', '.tmp', 'schema-version-99.json'), JSON.stringify(j));
    const r = await runCli(['replay', pjoin('test', '.tmp', 'schema-version-99.json')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unsupported report schemaVersion 99/);
  });
});
