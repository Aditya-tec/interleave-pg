import { initDb } from '../src/initdb.js';

export function adminDsn(): string {
  const v = process.env.RACEPROOF_ADMIN_DSN;
  if (!v) throw new Error('RACEPROOF_ADMIN_DSN must point at the local Postgres admin database (e.g. postgres://postgres:...@127.0.0.1:5433/postgres)');
  return v;
}

let cached: string | undefined;
/** Idempotently creates the throwaway `raceproof_test` database and returns its DSN. */
export async function testDsn(): Promise<string> {
  if (!cached) cached = await initDb({ adminDsn: adminDsn(), name: 'raceproof_test' });
  return cached;
}
