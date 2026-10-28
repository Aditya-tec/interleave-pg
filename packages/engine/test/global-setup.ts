import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** CLI tests run the built binary: always build first so they never test a stale dist/. */
export default function setup() {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
  const tsc = join(pkg, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: pkg, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('build failed:\n' + r.stdout + r.stderr);
  // The metrics script (eval/) is compiled too, so its tests never run against a stale build.
  const root = join(pkg, '..', '..');
  const e = spawnSync(process.execPath, [tsc, '-p', join(root, 'eval', 'tsconfig.json')], { cwd: root, encoding: 'utf8' });
  if (e.status !== 0) throw new Error('eval build failed:\n' + e.stdout + e.stderr);
}
