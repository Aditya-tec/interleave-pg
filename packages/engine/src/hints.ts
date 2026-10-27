import type { Step } from './controller.js';

/** Best-effort classification of a failing trace. Always labelled heuristic: never present as certain. */
export interface Hint {
  label: string;
  heuristic: true;
  detail: string;
  /** Typical fix pattern (docs Appendix A). */
  fix: string;
}

const FIX: Record<string, string> = {
  'read-modify-write': 'do the update in one statement (UPDATE t SET n = n + $1), or SELECT ... FOR UPDATE inside a transaction',
  'check-then-insert': 'add a unique constraint and INSERT ... ON CONFLICT',
  'write-skew': 'SELECT ... FOR UPDATE on the rows you read, or SERIALIZABLE with retry on 40001',
  phantom: 'lock the range with an advisory lock, or SERIALIZABLE with retry on 40001',
  'idempotency-race': 'insert the event/idempotency key first (unique), then act, in one transaction',
  deadlock: 'always lock rows in a consistent order (e.g. lower id first)',
};

type Op = { step: number; actor: string; kind: 'select' | 'update' | 'insert' | 'delete'; table: string; sql: string; params?: string; inTxn: boolean };

const NAME = String.raw`("(?:[^"]|"")+"|[\w.]+)`;
const clean = (t: string) => t.replace(/^"|"$/g, '').replace(/""/g, '"').toLowerCase();

function parse(s: Step): Op | undefined {
  const sql = s.sql.trim();
  let m: RegExpMatchArray | null;
  let kind: Op['kind'] | undefined;
  let table: string | undefined;
  if ((m = sql.match(new RegExp(String.raw`^select\b[\s\S]*?\bfrom\s+${NAME}`, 'i')))) { kind = 'select'; table = m[1]; }
  else if ((m = sql.match(new RegExp(String.raw`^update\s+${NAME}`, 'i')))) { kind = 'update'; table = m[1]; }
  else if ((m = sql.match(new RegExp(String.raw`^insert\s+into\s+${NAME}`, 'i')))) { kind = 'insert'; table = m[1]; }
  else if ((m = sql.match(new RegExp(String.raw`^delete\s+from\s+${NAME}`, 'i')))) { kind = 'delete'; table = m[1]; }
  if (!kind || !table) return undefined;
  return { step: s.step, actor: s.actor, kind, table: clean(table), sql, params: JSON.stringify(s.params ?? null), inTxn: s.txn !== null };
}

export function classify(steps: Step[]): Hint[] {
  const hints: Hint[] = [];
  const add = (label: string, detail: string) => hints.push({ label, heuristic: true, detail, fix: FIX[label]! });
  const ops = steps.map(parse).filter((o): o is Op => !!o);
  const actors = [...new Set(ops.map((o) => o.actor))];
  const isWrite = (o: Op) => o.kind !== 'select';

  if (steps.some((s) => s.errorCode === '40P01')) add('deadlock', 'a statement was aborted with 40P01 (deadlock detected)');

  let skew = false;
  const tables = [...new Set(ops.map((o) => o.table))];
  for (const t of tables) {
    const per = actors.map((a) => ({
      a,
      sel: ops.filter((o) => o.actor === a && o.table === t && o.kind === 'select'),
      upd: ops.filter((o) => o.actor === a && o.table === t && o.kind === 'update'),
    }));
    // write skew: every actor reads then updates the same table inside overlapping transactions, with different update parameters
    const rmw = per.filter((p) => p.sel.length && p.upd.length && p.sel[0]!.step < p.upd[0]!.step);
    if (rmw.length >= 2) {
      const span = (actor: string) => {
        const st = steps.filter((x) => x.actor === actor && x.txn !== null).map((x) => x.step);
        return st.length ? ([Math.min(...st), Math.max(...st)] as const) : undefined;
      };
      const spans = rmw.map((p) => span(p.a));
      const inTxn = spans.every((x) => x !== undefined);
      // the transactions overlap in time, so neither saw the other's write
      const overlap = inTxn && Math.max(...spans.map((x) => x![0])) < Math.min(...spans.map((x) => x![1]));
      const distinct = new Set(rmw.map((p) => p.upd[0]!.params)).size === rmw.length;
      if (overlap && distinct) {
        skew = true;
        add('write-skew', `${rmw.map((p) => p.a).join(' and ')} each read "${t}" and then updated different rows based on that read`);
      }
    }
  }

  for (const x of actors) {
    for (const t of tables) {
      const mine = ops.filter((o) => o.actor === x && o.table === t);
      const sels = mine.filter((o) => o.kind === 'select');
      for (const sel of sels) {
        const rangeRead = /\bbetween\b|[<>]=?|\bexists\b/i.test(sel.sql.replace(/<>/g, ''));
        const later = mine.filter((o) => o.step > sel.step && isWrite(o));
        for (const w of later) {
          const between = ops.find((o) => o.actor !== x && o.table === t && isWrite(o) && o.step > sel.step && o.step < w.step);
          if (!between) continue;
          if (w.kind === 'update' && !skew && !hints.some((h) => h.label === 'read-modify-write')) {
            add('read-modify-write', `${x} read "${t}" (step ${sel.step}), ${between.actor} wrote it (step ${between.step}), then ${x} wrote it from the stale read (step ${w.step})`);
          }
          if (w.kind === 'insert' && between.kind === 'insert' && !hints.some((h) => h.label === 'check-then-insert')) {
            add('check-then-insert', `${x} checked "${t}" (step ${sel.step}), ${between.actor} inserted (step ${between.step}), then ${x} inserted (step ${w.step})`);
            if (/idempot|webhook|event|processed|deliver/.test(t)) add('idempotency-race', `"${t}" looks like an idempotency/event table`);
            if (rangeRead && !/count\(/i.test(sel.sql)) add('phantom', `the read on "${t}" is a range/existence predicate`);
          }
        }
      }
    }
  }
  return hints;
}
