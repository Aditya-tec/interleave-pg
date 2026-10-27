import { ScenarioError } from './errors.js';
import type { ExploreReport } from './explorer.js';

export const MAX_REPORT_BYTES = 1024 * 1024;

/** Appendix B shape, plus the few fields replay needs. */
export function serializeReport(r: ExploreReport): string {
  const out = {
    tool: r.tool,
    version: r.version,
    scenario: r.scenario,
    ...(r.scenarioFile ? { scenarioFile: r.scenarioFile } : {}),
    target: { host: r.target.host, port: r.target.port, db: r.target.db, isolation: r.target.isolation },
    coverage: r.coverage,
    oracles: r.oracles,
    violations: r.violations.map((v) => ({
      id: v.id,
      kind: v.kind,
      invariant: v.invariant,
      ...(v.detail ? { detail: v.detail } : {}),
      status: v.status,
      confirmed: v.confirmed,
      preemptions: v.preemptions,
      scheduleIndex: v.scheduleIndex,
      occurrences: v.occurrences,
      schedule: v.schedule,
      fingerprint: v.fingerprint,
      timeline: v.timeline.map((s) => ({
        step: s.step,
        actor: s.actor,
        txn: s.txn,
        sql: s.sql,
        params: s.params,
        result: s.result,
        ...(s.blockedBy ? { blockedBy: s.blockedBy } : {}),
      })),
      hints: v.hints.map((h) => ({ label: h.label, heuristic: true, detail: h.detail, fix: h.fix })),
      warnings: v.warnings,
    })),
    warnings: r.warnings,
    exitCode: r.exitCode,
  };
  const text = JSON.stringify(out, null, 2);
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new ScenarioError(`report too large (limit ${MAX_REPORT_BYTES} bytes)`);
  return text;
}

export interface SavedFinding {
  id: string;
  kind: 'VIOLATION' | 'ANOMALY';
  invariant: string;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  schedule: string[];
  fingerprint: string;
}
export interface SavedReport {
  tool: 'interleave-pg';
  version: string;
  scenario: string;
  scenarioFile?: string;
  isolation: 'default' | 'rc' | 'rr' | 'ser';
  violations: SavedFinding[];
}

const bad = (m: string): never => {
  throw new ScenarioError(`invalid report: ${m}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, name: string, max: number): string => {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) bad(`"${name}" must be a non-empty string of at most ${max} characters`);
  return v as string;
};

/** S10: a saved report is untrusted. Size cap, strict schema, a fresh object with only the fields we use, no eval. */
export function parseReport(text: string): SavedReport {
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new ScenarioError(`report too large (limit ${MAX_REPORT_BYTES} bytes)`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('not valid JSON');
  }
  if (!isObj(raw)) bad('top level must be an object');
  const r = raw as Record<string, unknown>;
  if (r.tool !== 'interleave-pg') bad('"tool" must be "interleave-pg"');
  const target = r.target;
  if (!isObj(target)) bad('"target" is required');
  const isolation = (target as Record<string, unknown>).isolation;
  if (!['default', 'rc', 'rr', 'ser'].includes(isolation as string)) bad('"target.isolation" is not a known level');
  if (!Array.isArray(r.violations) || r.violations.length > 50) bad('"violations" must be an array of at most 50 findings');
  const violations: SavedFinding[] = (r.violations as unknown[]).map((v, i) => {
    if (!isObj(v)) return bad(`violations[${i}] must be an object`);
    const f = v as Record<string, unknown>;
    if (typeof f.id !== 'string' || !/^v\d{1,4}$/.test(f.id)) bad(`violations[${i}].id is malformed`);
    if (f.kind !== 'VIOLATION' && f.kind !== 'ANOMALY') bad(`violations[${i}].kind is malformed`);
    if (f.status !== 'CONFIRMED' && f.status !== 'UNCONFIRMED') bad(`violations[${i}].status is malformed`);
    if (!Array.isArray(f.schedule) || f.schedule.length === 0 || f.schedule.length > 5000) bad(`violations[${i}].schedule must have 1-5000 entries`);
    for (const a of f.schedule as unknown[]) {
      if (typeof a !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(a)) bad(`violations[${i}].schedule has a malformed actor id`);
    }
    if (typeof f.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(f.fingerprint)) bad(`violations[${i}].fingerprint is malformed`);
    return {
      id: f.id as string,
      kind: f.kind as 'VIOLATION' | 'ANOMALY',
      invariant: str(f.invariant, `violations[${i}].invariant`, 300),
      status: f.status as 'CONFIRMED' | 'UNCONFIRMED',
      schedule: [...(f.schedule as string[])],
      fingerprint: f.fingerprint as string,
    };
  });
  return {
    tool: 'interleave-pg',
    version: str(r.version, 'version', 32),
    scenario: str(r.scenario, 'scenario', 300),
    ...(r.scenarioFile === undefined ? {} : { scenarioFile: str(r.scenarioFile, 'scenarioFile', 500) }),
    isolation: isolation as SavedReport['isolation'],
    violations,
  };
}
