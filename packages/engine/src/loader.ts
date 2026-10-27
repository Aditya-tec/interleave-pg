import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScenarioError } from './errors.js';
import { validateScenario, type ScenarioDefinition } from './scenario.js';

function nodeSupportsTs(version = process.versions.node): boolean {
  const [maj = 0, min = 0] = version.split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
}

export async function loadScenario(file: string): Promise<{ scenario: ScenarioDefinition; dir: string }> {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new ScenarioError(`scenario file not found: ${file}`);
  if (/\.(ts|mts|cts)$/.test(abs) && !nodeSupportsTs()) {
    throw new ScenarioError(
      `cannot load ${file}: TypeScript scenarios need Node >= 22.18 (native type stripping) and this is Node ${process.versions.node}. Use a .mjs scenario or upgrade Node.`,
    );
  }
  let mod: any;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e: any) {
    throw new ScenarioError(`cannot load ${file}: ${e?.message ?? e}`);
  }
  return { scenario: validateScenario(mod.default), dir: dirname(abs) };
}
