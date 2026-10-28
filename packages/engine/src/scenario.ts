import { ScenarioError } from './errors.js';

export interface Db {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface ActorResult {
  actor: string;
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  error?: { code?: string; message: string; constraint?: string };
}

export type Invariant =
  | { name: string; sql: string }
  | { name: string; js: (a: { results: ActorResult[]; db: Db }) => { ok: boolean; detail?: string } | Promise<{ ok: boolean; detail?: string }> };

export interface ScenarioOptions {
  maxPreemptions?: number;
  maxSchedules?: number;
  serialOracle?: boolean;
  ignoreColumns?: string[];
}

export interface ScenarioDefinition<Ctx = any> {
  name: string;
  tables: string[];
  schema?: string;
  seed?: (db: Db) => Promise<void> | void;
  setup?: (env: { dsn: string }) => Promise<Ctx> | Ctx;
  actors: Record<string, (ctx: Ctx) => unknown>;
  invariants?: Invariant[];
  options?: ScenarioOptions;
}

export function defineScenario<Ctx = any>(s: ScenarioDefinition<Ctx>): ScenarioDefinition<Ctx> {
  return s;
}

export function validateScenario(s: any): ScenarioDefinition {
  const bad = (m: string) => { throw new ScenarioError(`invalid scenario: ${m}`); };
  if (!s || typeof s !== 'object') bad('default export must be an object (use defineScenario)');
  if (typeof s.name !== 'string' || !s.name) bad('"name" is required');
  if (!Array.isArray(s.tables) || s.tables.some((t: unknown) => typeof t !== 'string')) bad('"tables" must be an array of table names');
  if (!s.actors || typeof s.actors !== 'object') bad('"actors" is required');
  const ids = Object.keys(s.actors);
  if (ids.length < 2) bad('at least 2 actors are required');
  if (ids.length > 4) bad('at most 4 actors are supported');
  for (const id of ids) if (typeof s.actors[id] !== 'function') bad(`actor "${id}" must be a function`);
  return s as ScenarioDefinition;
}
