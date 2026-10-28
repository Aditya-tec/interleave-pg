// The stability criterion, as a function so it can be tested.
//   strict:  every field of every scenario must be identical (outcome, schedules explored, why the search stopped,
//            confirmed and unconfirmed findings, preemption count, schedule index of the first violation).
//   amended: outcome, findings, confirmations, preemption counts and first-violation index must be identical for every
//            scenario; schedules explored and the stop reason are compared only when NEITHER run stopped by time budget
//            (a wall-clock budget makes a large search machine-speed dependent by design). Time-budget stops are listed.
// Wall-clock time is never compared.
const ALWAYS = (r) => JSON.stringify([r.id, r.outcome, r.confirmed, r.unconfirmed, r.observedPreemptions ?? null]);
const COUNTS = (r) => JSON.stringify([r.explored, r.stoppedBy]);
const FIRST = (r) => JSON.stringify(r.firstViolationIndex ?? null);

/** @returns {{ differences: {id: string, expected: string, got: string}[], timeBudgetStops: {id: string, explored: number}[] }} */
export function diffRows(baseRows, curRows, criterion) {
  const differences = [];
  const timeBudgetStops = [];
  const cur = new Map(curRows.map((r) => [r.id, r]));
  for (const b of baseRows) {
    const c = cur.get(b.id);
    if (!c) { differences.push({ id: b.id, expected: JSON.stringify(b), got: 'missing' }); continue; }
    const tb = b.stoppedBy === 'time-budget' || c.stoppedBy === 'time-budget';
    if (c.stoppedBy === 'time-budget') timeBudgetStops.push({ id: c.id, explored: c.explored });
    const parts = [ALWAYS];
    if (criterion === 'strict' || !tb) parts.push(COUNTS);
    // the first-violation index depends on the order of exploration, not on the budget, unless the search was cut before it
    if (criterion === 'strict') parts.push(FIRST);
    else if (!tb) parts.push(FIRST);
    for (const f of parts) if (f(b) !== f(c)) { differences.push({ id: b.id, expected: f(b), got: f(c) }); break; }
  }
  return { differences, timeBudgetStops };
}
