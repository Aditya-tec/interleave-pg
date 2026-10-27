import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDsn } from './helpers.js';

export const here = dirname(fileURLToPath(import.meta.url));
export const pkg = join(here, '..');
export const cli = join(pkg, 'dist', 'cli.js');
export const seed = (f: string) => join(here, 'fixtures', 'seeds', f);

export async function runCli(args: string[], env: Record<string, string | undefined> = {}, cwd = pkg) {
  const dsn = await testDsn();
  const e: Record<string, string | undefined> = { ...process.env, INTERLEAVE_DSN: dsn, NODE_ENV: 'test', ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: e as NodeJS.ProcessEnv, cwd, timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
