import { createHash } from 'node:crypto';
import { quoteTable } from './sql.js';
import type { ActorResult } from './scenario.js';

/** Retriable aborts: the database killed the transaction; the app is expected to retry. */
export const RETRIABLE_CODES = new Set(['40001', '40P01']);

export interface Outcome {
  /** Hash of the final database snapshot. */
  snapshot: string;
  /** Per-actor normalized result. */
  results: Record<string, string>;
}

function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}

/** SQLSTATE (5 chars) for database errors, the message for application errors, stable JSON for values. */
export function normalizeResult(r: ActorResult): string {
  if (r.status === 'fulfilled') return 'ok:' + stable(r.value);
  const code = r.error?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return 'db:' + code;
  return 'err:' + (r.error?.message ?? 'unknown');
}

export function outcomeKey(o: Outcome, actors: string[]): string {
  return JSON.stringify([o.snapshot, [...actors].sort().map((a) => [a, o.results[a]])]);
}

export function retriableAborts(results: Record<string, string>): string[] {
  return Object.keys(results).filter((a) => /^db:(40001|40P01)$/.test(results[a]!)).sort();
}

export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

/**
 * Is this concurrent outcome equal to the outcome of some serial order? Actors aborted by the database
 * (40001, 40P01) are compared against serial executions of the remaining actors only.
 */
export function isSerializable(o: Outcome, reference: (actors: string[]) => Set<string>): boolean {
  const aborted = retriableAborts(o.results);
  const remaining = Object.keys(o.results).filter((a) => !aborted.includes(a)).sort();
  if (remaining.length === 0) return true;
  return reference(remaining).has(outcomeKey(o, remaining));
}

export interface Snapshot {
  tables: Record<string, string[]>;
}

interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Canonical content of the scenario tables: every row as JSON, sorted, minus identity/serial columns
 * (their values depend on insertion order) and minus `ignoreColumns`. Compared as a multiset of rows.
 */
export async function takeSnapshot(db: Queryable, tables: string[], ignoreColumns: string[]): Promise<Snapshot> {
  const out: Snapshot = { tables: {} };
  for (const table of tables) {
    const qt = quoteTable(table);
    const cols = (
      await db.query(
        `SELECT a.attname AS name, a.attidentity <> '' AS ident, coalesce(pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%', false) AS serial
           FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
        [qt],
      )
    ).rows.filter((c: any) => !c.ident && !c.serial && !ignoreColumns.includes(c.name));
    let rows: string[];
    if (cols.length === 0) {
      rows = [String((await db.query(`SELECT count(*)::text AS n FROM ${qt}`)).rows[0].n)];
    } else {
      const list = cols.map((c: any) => '"' + String(c.name).replace(/"/g, '""') + '"').join(', ');
      rows = (await db.query(`SELECT row_to_json(t)::text AS j FROM (SELECT ${list} FROM ${qt}) t`)).rows.map((r: any) => r.j as string);
      rows.sort();
    }
    out.tables[table] = rows;
  }
  return out;
}

export function hashSnapshot(s: Snapshot): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex');
}
