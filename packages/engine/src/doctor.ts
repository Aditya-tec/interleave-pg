import { loadScenario } from './loader.js';
import { checkTargetStatic, parseDsn, redactDsn, UnsafeTargetError, type Target } from './guard.js';
import { connectUnhooked, loadPg } from './pg-load.js';

export interface DoctorResult {
  lines: string[];
  ok: boolean;
  /** The target was refused by the safety guard (CLI exit code 3). */
  refused: boolean;
}

const COMPOSE_FIX = 'start the local database with `interleave-pg init-db --compose > docker-compose.yml && docker compose up -d --wait`, then run `interleave-pg init-db`';

/**
 * Checks the setup and says what to do about every problem. Never throws for a misconfiguration: each one becomes a
 * `[FAIL]` line followed by a `fix:` line. `scenario` (optional) adds checks of that scenario file.
 */
export async function doctor(dsn: string | undefined, fromDir: string, scenarioFile?: string): Promise<DoctorResult> {
  const lines: string[] = [];
  let ok = true;
  let refused = false;
  const pass = (msg: string) => { lines.push(`[ok] ${msg}`); };
  const fail = (msg: string, fix: string) => { ok = false; lines.push(`[FAIL] ${redactDsn(msg)}`, `    fix: ${fix}`); };
  const note = (msg: string) => { lines.push(`[note] ${msg}`); };

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) pass(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} (need >= 20)`, 'install Node 20 or newer');

  let pg: any;
  try {
    pg = loadPg(fromDir);
    pass(`pg resolves from ${fromDir}`);
  } catch {
    fail(`pg is not resolvable from ${fromDir}`, 'run `npm install pg` in the project under test');
  }

  // The target: the same checks, in the same order, as the guard that runs before every connection.
  let target: Target | undefined;
  if (!dsn) {
    refused = true;
    fail('no DSN: INTERLEAVE_DSN is not set and --dsn was not given', 'create a throwaway database (`interleave-pg init-db --compose` prints a compose file) and set INTERLEAVE_DSN to the DSN `interleave-pg init-db` prints');
  } else {
    try {
      target = parseDsn(dsn);
      checkTargetStatic(target, process.env);
    } catch (e: any) {
      if (!(e instanceof UnsafeTargetError)) throw e;
      refused = true;
      const m = String(e.message);
      const fix = /not local/.test(m)
        ? 'point INTERLEAVE_DSN at a Postgres on this machine (localhost, 127.0.0.1, ::1 or a unix socket); remote servers are never allowed'
        : /NODE_ENV/.test(m)
          ? 'unset NODE_ENV (or set it to test or development) for this command; interleave-pg never runs when NODE_ENV is production'
          : /database name/.test(m)
            ? 'use a database whose name starts with interleave_, e.g. `interleave-pg init-db --name interleave_dev`'
            : 'fix the DSN as the message says; see docs/LIMITATIONS.md for what the DSN may contain';
      fail(m.replace(/^refusing target: /, 'target refused: '), fix);
      target = undefined;
    }
  }

  let connected = false;
  let probe: any;
  if (target && pg) {
    try {
      probe = await connectUnhooked(pg, target);
      connected = true;
    } catch (e: any) {
      if (e instanceof UnsafeTargetError) {
        refused = true;
        fail(String(e.message), 'use a local throwaway database created by `interleave-pg init-db`');
      } else {
        fail(`cannot connect to ${target.host}:${target.port}: ${String(e?.message ?? e)}`, COMPOSE_FIX);
      }
    }
  }
  if (connected) {
    try {
      const m = await probe.query(`SELECT to_regclass('public.interleave_marker') IS NOT NULL AS ok`);
      if (m.rows[0]?.ok === true) {
        pass(`target ${target!.host}:${target!.port}/${target!.database} is local and has the interleave-pg marker table`);
      } else {
        refused = true;
        fail(
          `database ${target!.database} has no marker table interleave_marker, so it was not created by interleave-pg`,
          `create a database with \`interleave-pg init-db --name ${target!.database.startsWith('interleave_') ? target!.database : 'interleave_dev'}\` using a maintenance DSN`,
        );
      }
      const v = (await probe.query('SHOW server_version')).rows[0].server_version as string;
      const maj = Number(v.split('.')[0]);
      if (maj >= 14 && maj <= 18) pass(`Postgres ${v} (tested range 14-18)`);
      else note(`Postgres ${v} is outside the tested range 14-18`);
      const d = (await probe.query('SHOW deadlock_timeout')).rows[0].deadlock_timeout as string;
      pass(`deadlock_timeout is ${d} (init-db default 300ms; below about 100ms the deadlock victim can vary under CPU load)`);

      if (scenarioFile && !refused) await checkScenario(scenarioFile, probe);
    } finally {
      await probe.end().catch(() => {});
    }
  } else if (scenarioFile) {
    await checkScenario(scenarioFile, undefined);
  }

  async function checkScenario(file: string, db: any): Promise<void> {
    let loaded;
    try {
      loaded = await loadScenario(file);
    } catch (e: any) {
      fail(`scenario ${file} cannot be used: ${String(e?.message ?? e).split('\n')[0]}`, 'check the path and the scenario file (see examples/gift-card/scenario.mjs for the shape)');
      return;
    }
    const { scenario, dir } = loaded;
    pass(`scenario "${scenario.name}" loads (${Object.keys(scenario.actors).length} actors, ${scenario.tables.length} tables)`);
    try {
      loadPg(dir);
      pass(`pg resolves from the scenario directory ${dir}`);
    } catch {
      fail(`pg is not resolvable from the scenario directory ${dir}`, 'run `npm install pg` in the project that contains the scenario, so the scenario and the code under test use the same pg');
    }
    if (db && !scenario.schema) {
      for (const t of scenario.tables) {
        const r = await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public."${t.replace(/"/g, '""')}"`]);
        if (r.rows[0]?.ok !== true) {
          fail(`table "${t}" listed in "tables" does not exist in the database and the scenario has no "schema"`, `add \`schema: 'file.sql'\` to the scenario (a file that creates the table) or create/migrate the table in ${target!.database} first`);
        }
      }
    }
  }

  return { lines, ok, refused };
}

export { parseDsn, UnsafeTargetError };
