import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ScenarioError } from './errors.js';

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder, so symlinks cannot hide an escape. */
function realish(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(existsSync(cur) ? realpathSync(cur) : cur, ...rest);
}

const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

/** S10: only paths inside one of `roots` (the working directory or an explicitly allowed directory) are accepted. */
export function resolveInside(p: string, roots: string[], what: string): string {
  const real = realish(p);
  for (const root of roots) if (inside(realish(root), real)) return real;
  throw new ScenarioError(`${what} "${p}" is outside the working directory (name another directory with --allow-dir)`);
}
