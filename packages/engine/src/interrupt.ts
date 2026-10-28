export interface InterruptDeps {
  proc?: Pick<NodeJS.Process, 'on' | 'off'>;
  exit?: (code: number) => void;
  write?: (message: string) => void;
  /** How long cleanup may take before the process exits anyway. */
  graceMs?: number;
}

/**
 * Ctrl-C (SIGINT) and SIGTERM: run `cleanup` (roll back, close connections, release the lock) once, then exit with the
 * conventional 128+signal code. A second signal, or a cleanup that outlasts `graceMs`, exits immediately.
 * Returns a function that removes the handlers.
 */
export function onInterrupt(cleanup: () => Promise<void>, deps: InterruptDeps = {}): () => void {
  const proc = deps.proc ?? process;
  const exit = deps.exit ?? ((c: number) => process.exit(c));
  const write = deps.write ?? ((m: string) => { process.stderr.write(m); });
  const graceMs = deps.graceMs ?? 5000;
  let started = false;
  let code = 130;

  const handler = (signal: NodeJS.Signals) => {
    code = signal === 'SIGTERM' ? 143 : 130;
    if (started) {
      exit(code);
      return;
    }
    started = true;
    write(`\ninterrupted (${signal}): rolling back and closing connections...\n`);
    const timer = setTimeout(() => exit(code), graceMs);
    timer.unref();
    cleanup().then(
      () => { clearTimeout(timer); exit(code); },
      () => { clearTimeout(timer); exit(code); },
    );
  };
  const onInt = () => handler('SIGINT');
  const onTerm = () => handler('SIGTERM');
  proc.on('SIGINT', onInt);
  proc.on('SIGTERM', onTerm);
  return () => {
    proc.off('SIGINT', onInt);
    proc.off('SIGTERM', onTerm);
  };
}
