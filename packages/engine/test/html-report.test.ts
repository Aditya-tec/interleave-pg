import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { explore } from '../src/explorer.js';
import { escapeHtml, renderHtml } from '../src/html-report.js';
import { loadScenario } from '../src/loader.js';
import { createSession, type Session } from '../src/runner.js';
import { pkg, runCli, seed } from './cli-helpers.js';
import { testDsn } from './helpers.js';

const PAYLOADS = [
  '<script>alert(1)</script>',
  '"onerror="alert(1)" x="',
  "'><img src=x onerror=alert(1)>",
  '</td></tr></table><h1>injected</h1>',
  '&lt;b&gt; & &amp;',
  '`${alert(1)}`',
  '<svg/onload=alert(1)>',
  ' <!-- -->',
];

function hostileReport(): any {
  const [a, b, c, d, e, f, g, h] = PAYLOADS;
  return {
    tool: 'interleave-pg',
    version: '0.0.0',
    scenario: a,
    scenarioFile: b,
    target: { host: c, port: 5433, db: d, isolation: 'default' },
    coverage: { explored: 3, preemptionBound: 3, exhaustiveWithinBound: true, stoppedBy: 'complete', strategy: 'dfs', serialReferenceRuns: 2, actors: 2, schedulesByPreemptions: [2, 1] },
    oracles: ['invariants', e],
    oracle: { status: 'unreliable', reason: f },
    violations: [
      {
        id: 'v1', kind: 'VIOLATION', invariant: g, detail: h, status: 'CONFIRMED', confirmed: '3/3', preemptions: 1, scheduleIndex: 2, occurrences: 1,
        notice: a, schedule: [c, 'B'], fingerprint: 'a'.repeat(64),
        timeline: [{ step: 1, actor: c, txn: d, sql: `INSERT INTO t VALUES ('${a}')`, params: [b, e, f], result: `1 row {"x":"${g}"}` }],
        hints: [{ label: a, heuristic: true, detail: b, fix: c }],
        warnings: [d],
      },
    ],
    warnings: [e, f],
    notes: [g, h],
    stats: { abortCodes: [], blockedSeen: false, constraintErrors: false, violatingSchedules: 1 },
    durationMs: 1,
    exitCode: 1,
  };
}

describe('S4: the HTML report escapes every dynamic string', () => {
  it('escapeHtml neutralises & < > " \' and nothing else is needed in text or quoted attributes', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(escapeHtml(String(123))).toBe('123');
    expect(escapeHtml(undefined as any)).toBe('');
  });
  it('hostile payloads in every field appear only as escaped text: no tag, no attribute, no script', () => {
    const html = renderHtml(hostileReport());
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<h1>injected');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // every tag in the document is one of ours, with static attributes only
    const tags = html.match(/<[^>]*>/g) ?? [];
    const allowed = /^<(!doctype html|!-- [a-z -]+ --|\/?(html|head|body|title|style|h1|h2|h3|p|table|thead|tbody|tr|th|td|details|summary|code|pre|span|ul|li|section|footer|header|main|strong)|details open|meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"|meta( [a-z-]+="[^"<>&']*")+|html lang="en"|[a-z0-9]+ class="[a-z0-9 -]+"|td class="[a-z0-9 -]+"|th class="[a-z0-9 -]+")\/?>$/i;
    const bad = tags.filter((t) => !allowed.test(t));
    expect(bad).toEqual([]);
  });
  it('declares a Content-Security-Policy that forbids scripts and network access, and contains no script element at all', () => {
    const html = renderHtml(hostileReport());
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/);
    expect(html).not.toMatch(/<(script|link|iframe|object|embed)/i);
    expect((html.match(/<[^>]*>/g) ?? []).filter((t) => /(src|href|on[a-z]+)s*=/i.test(t))).toEqual([]);
  });
  it('starts with the marker the writer uses to recognise its own files', () => {
    expect(renderHtml(hostileReport()).slice(0, 200)).toContain('<!-- interleave-pg report -->');
  });
});

describe('--html through the CLI', () => {
  let dsn: string;
  let session: Session | undefined;
  beforeAll(async () => { dsn = await testDsn(); });
  afterEach(async () => { await session?.close(); session = undefined; });

  it('a real report renders: findings, timeline, coverage statement; and a real hostile scenario stays inert', async () => {
    const out = join('test', '.tmp', 'report.html');
    const r = await runCli(['run', seed('xss-payload.mjs'), '--html', out]);
    expect(r.code).toBe(1);
    const html = readFileSync(join(pkg, out), 'utf8');
    expect(html).toMatch(/Coverage: explored \d+ schedules?, preemption bound 3, exhaustive within bound: yes, stopped by: complete/);
    expect(html).toContain('both deposits counted');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const bad = (html.match(/<[^>]*>/g) ?? []).filter((t) => /script|img|svg|onerror|onload/i.test(t));
    expect(bad).toEqual([]);
  });
  it('--html needs a .html name, refuses to overwrite a file that is not one of its reports, and obeys the path rules', async () => {
    mkdirSync(join(pkg, 'test', '.tmp'), { recursive: true });
    writeFileSync(join(pkg, 'test', '.tmp', 'precious.html'), '<html>my page</html>');
    let r = await runCli(['run', seed('lost-update-safe.mjs'), '--html', join('test', '.tmp', 'precious.html')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not an interleave-pg report/);
    expect(readFileSync(join(pkg, 'test', '.tmp', 'precious.html'), 'utf8')).toBe('<html>my page</html>');
    r = await runCli(['run', seed('lost-update-safe.mjs'), '--html', join('test', '.tmp', 'x.txt')]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/\.html/);
    r = await runCli(['run', seed('lost-update-safe.mjs'), '--html', join('..', '..', 'escape.html')]);
    expect(r.code).toBe(2);
    expect(existsSync(join(pkg, '..', '..', 'escape.html'))).toBe(false);
  });
  it('an HTML report of a clean run overwrites an earlier report of ours', async () => {
    const out = join('test', '.tmp', 'again.html');
    expect((await runCli(['run', seed('lost-update.mjs'), '--html', out])).code).toBe(1);
    expect((await runCli(['run', seed('lost-update-safe.mjs'), '--html', out])).code).toBe(0);
    expect(readFileSync(join(pkg, out), 'utf8')).toMatch(/No violations found/);
  });
  it('renders a report object built from a real run with no exception', async () => {
    const { scenario, dir } = await loadScenario(seed('lost-update.mjs'));
    session = await createSession(scenario, { dsn, scenarioDir: dir });
    const html = renderHtml(await explore(session, {}));
    expect(html).toMatch(/CONFIRMED/);
  });
});
