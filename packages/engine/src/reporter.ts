import type { RunResult } from './runner.js';

const trunc = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 3) + '...' : one;
};

export function coverageStatement(explored: number, forced: boolean): string {
  return `explored ${explored} schedule${explored === 1 ? '' : 's'}${forced ? ' (forced)' : ''}, preemption bound: n/a, exhaustive within bound: no, stopped by: ${forced ? 'forced-schedule' : 'complete'}`;
}

export function formatRun(r: RunResult): string {
  const out: string[] = [];
  out.push(`Scenario: ${r.scenario}`);
  out.push(`Target:   ${r.target.host}:${r.target.port}/${r.target.database}`);
  out.push(`Schedule: ${r.schedule.join(',')} (forced)`);
  out.push('');
  out.push(' #  Actor Txn  SQL                                              Params          Result');
  for (const s of r.steps) {
    const params = s.params && s.params.length ? trunc(JSON.stringify(s.params), 14) : '';
    out.push(
      `${String(s.step).padStart(2)}  ${s.actor.padEnd(5)} ${(s.txn ?? '-').padEnd(4)} ${trunc(s.sql, 48).padEnd(48)} ${params.padEnd(15)} ${trunc(s.result, 60)}`,
    );
    if (s.blockedBy) {
      out.push(`      ^ [BLOCKED] ${s.actor} waited on ${s.blockedBy.length ? s.blockedBy.join(', ') : 'another session'} before this statement completed`);
    }
  }
  out.push('');
  out.push('Outcomes:');
  for (const a of r.results) {
    out.push(`  ${a.actor}: ${a.status}${a.error ? ` (${a.error.code ? a.error.code + ': ' : ''}${trunc(a.error.message, 80)})` : ''}`);
  }
  for (const w of r.warnings) out.push(`warning: ${w}`);
  out.push('');
  if (r.violations.length) {
    for (const v of r.violations) {
      out.push(`VIOLATION: ${v.invariant}${v.detail ? ' - ' + v.detail : ''}`);
    }
    out.push('Observed in 1 run under this forced schedule. Replay confirmation (3x) is a Phase 2 feature, so this is not yet "CONFIRMED".');
  } else {
    out.push(`No violations found in 1 schedule (forced schedule ${r.schedule.join(',')}; exhaustive within bound: no)`);
  }
  out.push(`Coverage: ${coverageStatement(1, true)}`);
  return out.join('\n');
}
