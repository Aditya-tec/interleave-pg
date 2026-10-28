import { redactDsn } from './guard.js';

export const COMMANDS = ['init-db', 'run', 'replay', 'doctor'];

function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest command name, if one is near enough to be a typo. */
export function suggestCommand(word: string): string | undefined {
  const scored = COMMANDS.map((c) => [c, distance(word, c)] as const).sort((x, y) => x[1] - y[1]);
  return scored[0] && scored[0][1] <= 2 ? scored[0][0] : undefined;
}

/**
 * One sentence saying what went wrong and one saying what to do, for the mistakes people actually make. Anything this
 * does not recognise is returned as "Name: message" with DSNs redacted; nothing here ever prints a stack.
 */
export function explainError(e: any): string {
  const code: string | undefined = e?.code;
  const msg = redactDsn(String(e?.message ?? e));
  if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')) {
    const opt = /'(--?[\w-]+)'/.exec(msg)?.[1];
    return opt && /unknown option/i.test(msg)
      ? `unknown option ${opt} (see interleave-pg --help)`
      : `${msg.split('\n')[0]} (see interleave-pg --help)`;
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
    const where = e.address && e.port ? `${e.address}:${e.port}` : String(e.hostname ?? 'the database');
    return `cannot connect to ${where}: ${code === 'ECONNREFUSED' ? 'nothing is listening there' : msg}. Is the throwaway database running? Start it with \`docker compose up -d\` (\`interleave-pg init-db --compose\` prints the compose file), or run \`interleave-pg doctor\` to see what is wrong.`;
  }
  if (code === '3D000') return `${msg}. Create it with \`interleave-pg init-db --name <name>\` (using a maintenance DSN), or fix the database name in INTERLEAVE_DSN.`;
  if (code === '28P01' || code === '28000') return `${msg}. Check the user and password in INTERLEAVE_DSN (\`interleave-pg doctor\` shows the rest of the setup).`;
  return `${e?.name ?? 'Error'}: ${msg}`;
}
