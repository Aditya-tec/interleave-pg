import { coverageLine, type ExploreReport } from './explorer.js';

/** Escapes text for an HTML text node or a double- or single-quoted attribute value. */
export function escapeHtml(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const e = escapeHtml;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const CSS = `
:root{--bg:#fff;--fg:#1b1f24;--muted:#57606a;--line:#d0d7de;--bad:#cf222e;--warn:#9a6700;--ok:#1a7f37;--code:#f6f8fa}
@media (prefers-color-scheme: dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--bad:#ff7b72;--warn:#d29922;--ok:#3fb950;--code:#161b22}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1.1rem;margin:24px 0 8px}
.muted{color:var(--muted)}.bad{color:var(--bad)}.warn{color:var(--warn)}.ok{color:var(--ok)}
code,pre{background:var(--code);border-radius:4px;font:13px/1.4 ui-monospace,monospace}
code{padding:1px 4px}pre{padding:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
td.sql{font-family:ui-monospace,monospace;word-break:break-word}
details{border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:8px 0}
summary{cursor:pointer;font-weight:600}
.banner{border:1px solid var(--warn);border-radius:6px;padding:8px 12px;margin:12px 0}
@media (max-width:600px){main{padding:16px 12px}}
`;

/** One self-contained HTML page: inline CSS, no script, no external reference, every dynamic string escaped. */
export function renderHtml(r: ExploreReport): string {
  const out: string[] = [];
  out.push('<!doctype html>');
  out.push('<!-- interleave-pg report -->');
  out.push('<html lang="en">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
  out.push(`<title>${e(r.scenario)} - interleave-pg</title>`);
  out.push(`<style>${CSS}</style>`);
  out.push('</head>');
  out.push('<body>');
  out.push('<main>');
  out.push(`<h1>${e(r.scenario)}</h1>`);
  out.push(`<p class="muted">Target ${e(r.target.host)}:${e(r.target.port)}/${e(r.target.db)}, isolation ${e(r.target.isolation)}. interleave-pg ${e(r.version)}.${r.scenarioFile ? ` Scenario file <code>${e(r.scenarioFile)}</code>.` : ''}</p>`);
  out.push(`<p>Oracles: ${r.oracles.map((o) => `<code>${e(o)}</code>`).join(', ')}</p>`);
  if (r.oracle.status === 'unreliable') {
    out.push(`<p class="banner warn"><strong>The serial-equivalence oracle is UNRELIABLE for this scenario.</strong> ${e(r.oracle.reason)}. ANOMALY findings are suppressed; findings from your invariants are unaffected.</p>`);
  }

  const confirmed = r.violations.filter((v) => v.status === 'CONFIRMED').length;
  out.push('<h2>Result</h2>');
  if (r.violations.length === 0) {
    out.push(`<p class="ok">No violations found in ${e(plural(r.coverage.explored, 'schedule'))} (${r.coverage.preemptionBound === null ? 'random scheduling' : `preemption bound ${e(r.coverage.preemptionBound)}`}, exhaustive within bound: ${r.coverage.exhaustiveWithinBound ? 'yes' : 'no'}).</p>`);
  } else if (confirmed === 0) {
    out.push(`<p class="warn">Inconclusive: ${e(plural(r.violations.length, 'finding'))} could not be reproduced 3 of 3 times, so none is reported as a violation.</p>`);
  } else {
    out.push(`<p class="bad">${e(plural(confirmed, 'confirmed finding'))} in ${e(plural(r.coverage.explored, 'schedule'))} explored.</p>`);
  }
  if (r.coverage.stoppedBy !== 'complete') out.push(`<p class="warn">The search stopped early (${e(r.coverage.stoppedBy)}); it is not exhaustive.</p>`);
  out.push(`<p><code>${e(coverageLine(r.coverage))}</code></p>`);

  for (const f of r.violations) {
    const head = f.status === 'CONFIRMED' ? `CONFIRMED (${f.confirmed})` : `UNCONFIRMED (flaky, ${f.confirmed})`;
    out.push('<details open>');
    out.push(`<summary class="${f.status === 'CONFIRMED' ? 'bad' : 'warn'}">${e(head)} ${e(f.kind)}: ${e(f.invariant)}</summary>`);
    out.push(`<p>${f.detail ? `${e(f.detail)}. ` : ''}First seen at schedule #${e(f.scheduleIndex)} with ${e(plural(f.preemptions, 'preemption'))}; seen in ${e(plural(f.occurrences, 'schedule'))} in total.</p>`);
    out.push(`<p>Schedule: <code>${f.schedule.map((s) => e(s)).join(',')}</code></p>`);
    out.push('<table>');
    out.push('<thead><tr><th>#</th><th>Actor</th><th>Txn</th><th>SQL</th><th>Params</th><th>Result</th></tr></thead>');
    out.push('<tbody>');
    for (const s of f.timeline) {
      out.push(
        `<tr><td>${e(s.step)}</td><td>${e(s.actor)}</td><td>${e(s.txn ?? '-')}</td><td class="sql">${e(s.sql)}</td><td class="sql">${e(s.params && s.params.length ? JSON.stringify(s.params) : '')}</td><td>${e(s.result)}${s.blockedBy ? ` <span class="warn">[BLOCKED by ${e(s.blockedBy.join(', ') || 'another session')}]</span>` : ''}</td></tr>`,
      );
    }
    out.push('</tbody>');
    out.push('</table>');
    for (const h of f.hints) out.push(`<p class="muted">Hint (heuristic): <strong>${e(h.label)}</strong>: ${e(h.detail)}. Typical fix: ${e(h.fix)}</p>`);
    out.push(`<p class="muted">${e(f.notice)}</p>`);
    for (const w of f.warnings) out.push(`<p class="warn">Warning: ${e(w)}</p>`);
    out.push('</details>');
  }

  if (r.notes.length || r.warnings.length) {
    out.push('<h2>Notes and warnings</h2>');
    out.push('<ul>');
    for (const w of r.warnings) out.push(`<li class="warn">warning: ${e(w)}</li>`);
    for (const n of r.notes) out.push(`<li class="muted">note: ${e(n)}</li>`);
    out.push('</ul>');
  }
  out.push('<footer class="muted">Generated by interleave-pg. "No violations found" means none within the explored schedules and bound, not that the code is correct.</footer>');
  out.push('</main>');
  out.push('</body>');
  out.push('</html>');
  return out.join('\n') + '\n';
}
