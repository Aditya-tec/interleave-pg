import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
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

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * S10: only paths inside one of `roots` (the working directory or an explicitly allowed directory) are accepted.
 * The path must lie inside a root as written (not only after following links), and no component below that root,
 * including the final one, may be a symbolic link (or a directory junction); the real path is then checked again.
 */
export function resolveInside(p: string, roots: string[], what: string): string {
  const abs = resolve(p);
  for (const root of roots) {
    const r = resolve(root);
    if (!inside(r, abs)) continue;
    let cur = r;
    for (const part of relative(r, abs).split(sep).filter(Boolean)) {
      cur = join(cur, part);
      if (isLink(cur)) throw new ScenarioError(`${what} "${p}" goes through a symbolic link (${cur}); symbolic links are not followed`);
    }
    const real = realish(abs);
    if (inside(realish(r), real)) return real;
  }
  throw new ScenarioError(`${what} "${p}" is outside the working directory (name another directory with --allow-dir)`);
}

/** Validates --allow-dir values: real directories, no links, never a filesystem/drive root or the home directory. */
export function checkAllowDirs(dirs: string[]): string[] {
  return dirs.map((d) => {
    const abs = resolve(d);
    if (!existsSync(abs)) throw new ScenarioError(`--allow-dir "${d}" does not exist`);
    if (isLink(abs)) throw new ScenarioError(`--allow-dir "${d}" is a symbolic link; name the real directory`);
    if (!statSync(abs).isDirectory()) throw new ScenarioError(`--allow-dir "${d}" is not a directory`);
    const real = realpathSync(abs);
    if (parse(real).root === real) throw new ScenarioError(`--allow-dir "${d}" is a filesystem root; name a specific directory`);
    const home = realpathSync(homedir());
    const same = process.platform === 'win32' ? real.toLowerCase() === home.toLowerCase() : real === home;
    if (same) throw new ScenarioError(`--allow-dir "${d}" is your home directory; name a specific project directory`);
    return real;
  });
}

const MAX_EXISTING = 1024 * 1024;
export const HTML_MARKER = '<!-- interleave-pg report -->';

/** Everything writeReportFile checks, without writing. Returns the real target path. */
export function assertReportTarget(path: string, roots: string[], kind: 'json' | 'html' = 'json'): string {
  if (extname(path).toLowerCase() !== `.${kind}`) throw new ScenarioError(`report path "${path}" must end in .${kind}`);
  const target = resolveInside(path, roots, 'report path');
  if (existsSync(target)) {
    const st = lstatSync(target);
    if (st.isDirectory()) throw new ScenarioError(`report path "${path}" is a directory`);
    if (st.size > MAX_EXISTING) throw new ScenarioError(`"${path}" exists and is not an interleave-pg report (too large); it was not overwritten`);
    let ok = false;
    try {
      const text = readFileSync(target, 'utf8');
      if (kind === 'html') ok = text.slice(0, 200).includes(HTML_MARKER);
      else {
        const j = JSON.parse(text);
        ok = typeof j === 'object' && j !== null && j.tool === 'interleave-pg';
      }
    } catch {
      ok = false;
    }
    if (!ok) throw new ScenarioError(`"${path}" exists and is not an interleave-pg report; it was not overwritten`);
  }
  return target;
}

/** Atomic write: temp file in the same directory, then rename over the target. */
export function writeReportFile(path: string, text: string, roots: string[], kind: 'json' | 'html' = 'json'): string {
  const target = assertReportTarget(path, roots, kind);
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    writeFileSync(temp, text, { flag: 'wx' });
    renameSync(temp, target);
  } catch (e) {
    try {
      unlinkSync(temp);
    } catch {
      /* already gone */
    }
    throw e;
  }
  return target;
}
