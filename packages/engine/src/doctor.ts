import { assertSafeTarget, parseDsn, UnsafeTargetError } from './guard.js';
import { connectUnhooked, loadPg } from './pg-load.js';

export async function doctor(dsn: string | undefined, fromDir: string): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let ok = true;
  const add = (good: boolean, msg: string) => { lines.push(`[${good ? 'ok' : 'FAIL'}] ${msg}`); if (!good) ok = false; };

  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20, `Node ${process.versions.node} (need >= 20)`);

  let pg: any;
  try {
    pg = loadPg(fromDir);
    add(true, `pg resolves from ${fromDir}`);
  } catch {
    add(false, `pg is not resolvable from ${fromDir}: install pg in the project under test`);
    return { lines, ok };
  }

  // Throws UnsafeTargetError for an unsafe target: surfaced as exit code 3 by the CLI.
  const target = await assertSafeTarget(dsn, { connect: (t) => connectUnhooked(pg, t) });
  add(true, `target ${target.host}:${target.port}/${target.database} is local and has the interleave-pg marker table`);
  const c = await connectUnhooked(pg, target);
  try {
    const v = (await c.query('SHOW server_version')).rows[0].server_version as string;
    const maj = Number(v.split('.')[0]);
    add(maj >= 14 && maj <= 18, `Postgres ${v} (tested range 14-18)`);
    const d = (await c.query('SHOW deadlock_timeout')).rows[0].deadlock_timeout as string;
    add(d === '50ms', `deadlock_timeout is ${d} (init-db sets 50ms)`);
  } finally {
    await c.end();
  }
  return { lines, ok };
}

export { parseDsn, UnsafeTargetError };
