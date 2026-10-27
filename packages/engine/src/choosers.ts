/** Scheduling decisions: who runs next, and how the choice is made. Shared by the controller and the tests' model. */

export type ActorStatusView = 'DONE' | 'AT_GATE' | 'OTHER';

export interface DecisionCtx {
  /** 0-based index of this decision within the run. */
  index: number;
  /** Actors waiting at their gate, sorted by id. */
  runnable: string[];
  /** Actor released at the previous decision. */
  last?: string;
  status: (id: string) => ActorStatusView;
}

/** Returns the actor to release, or undefined to use the default policy. */
export type Chooser = (ctx: DecisionCtx) => string | undefined;

export interface Decision {
  index: number;
  runnable: string[];
  chosen: string;
  /** A switch away from an actor that is still runnable. Switches forced by blocking or completion are free. */
  preemption: boolean;
  /** The chooser named an actor that was not runnable (the run no longer follows the saved choices). */
  diverged?: boolean;
}

/** Default policy: continue the current actor if it is runnable, else the lowest id. */
export function defaultPick(ctx: DecisionCtx): string {
  return ctx.last !== undefined && ctx.runnable.includes(ctx.last) ? ctx.last : ctx.runnable[0]!;
}

export function decide(ctx: DecisionCtx, chooser: Chooser): Decision {
  const wanted = chooser(ctx);
  const diverged = wanted !== undefined && !ctx.runnable.includes(wanted);
  const chosen = wanted !== undefined && !diverged ? wanted : defaultPick(ctx);
  const preemption = ctx.last !== undefined && ctx.runnable.includes(ctx.last) && chosen !== ctx.last;
  return { index: ctx.index, runnable: ctx.runnable, chosen, preemption, ...(diverged ? { diverged: true } : {}) };
}

/** User-facing `--schedule`: entries name the next statement to release. Phase 1 semantics. */
export function forcedChooser(schedule: string[], warn: (m: string) => void): Chooser {
  let cursor = 0;
  return (ctx) => {
    while (cursor < schedule.length) {
      const want = schedule[cursor]!;
      const st = ctx.status(want);
      if (st === 'DONE') {
        warn(`schedule entry ${cursor + 1} ("${want}") skipped: actor already finished`);
        cursor++;
        continue;
      }
      if (st === 'AT_GATE') {
        cursor++;
        return want;
      }
      break; // blocked or still in flight: use the default policy and keep the entry
    }
    return undefined;
  };
}

/** Replays the first decisions of an earlier run exactly (one entry per decision), then the default policy. */
export function prefixChooser(prefix: string[]): Chooser {
  return (ctx) => (ctx.index < prefix.length ? prefix[ctx.index] : undefined);
}

/** Runs actors one after another in the given order (a serial execution). */
export function serialChooser(order: string[]): Chooser {
  return (ctx) => order.find((id) => ctx.runnable.includes(id));
}

/** Small, fast, seedable PRNG (no dependency). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomChooser(rng: () => number): Chooser {
  return (ctx) => ctx.runnable[Math.floor(rng() * ctx.runnable.length)];
}
