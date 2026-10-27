import { mulberry32, prefixChooser, randomChooser, type Chooser, type Decision } from './choosers.js';

export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export type StoppedBy = 'complete' | 'schedule-budget' | 'time-budget';

export type Executor<R extends { decisions: Decision[] } = { decisions: Decision[] }> = (chooser: Chooser) => Promise<R>;

export interface ScheduleInfo {
  /** 1-based position in the exploration order. */
  index: number;
  choices: string[];
  preemptions: number;
}

export interface ExploreOptions {
  maxPreemptions: number;
  maxSchedules: number;
  timeBudgetMs: number;
  maxActors?: number;
}

export interface ExploreSummary {
  explored: number;
  /** Executions whose full choice sequence had already been seen (not counted in `explored`). */
  duplicates: number;
  stoppedBy: StoppedBy;
  /** True only when every schedule within `maxPreemptions` was run. */
  exhaustive: boolean;
  maxPreemptions: number;
  strategy: 'dfs';
}

type OnSchedule<R> = (info: ScheduleInfo, result: R) => Promise<void> | void;

const preemptionCount = (ds: Decision[]) => ds.reduce((n, d) => n + (d.preemption ? 1 : 0), 0);

/**
 * Stateless model checking with iterative context bounding: every schedule with 0 preemptions, then 1,
 * then 2 ... up to `maxPreemptions`. Each execution replays a choice prefix from scratch; alternatives
 * are generated only for decisions after the prefix, so nothing is run twice.
 */
export async function exploreBounded<R extends { decisions: Decision[] }>(
  exec: Executor<R>,
  opts: ExploreOptions,
  clock: Clock,
  onSchedule?: OnSchedule<R>,
): Promise<ExploreSummary> {
  const maxActors = opts.maxActors ?? 4;
  const start = clock.now();
  const buckets: string[][][] = Array.from({ length: opts.maxPreemptions + 1 }, () => []);
  const queued = new Set<string>();
  const executed = new Set<string>();
  buckets[0]!.push([]);
  queued.add('');
  let explored = 0;
  let duplicates = 0;
  let stoppedBy: StoppedBy = 'complete';

  outer: for (let k = 0; k <= opts.maxPreemptions; k++) {
    const stack = buckets[k]!;
    while (stack.length > 0) {
      if (clock.now() - start >= opts.timeBudgetMs) { stoppedBy = 'time-budget'; break outer; }
      if (explored >= opts.maxSchedules) { stoppedBy = 'schedule-budget'; break outer; }
      const prefix = stack.pop()!;
      const result = await exec(prefixChooser(prefix));
      const ds = result.decisions;
      const choices = ds.map((d) => d.chosen);
      if (new Set(ds.flatMap((d) => d.runnable)).size > maxActors) throw new Error(`at most ${maxActors} actors are supported`);
      const key = choices.join(',');
      if (executed.has(key)) { duplicates++; continue; }
      executed.add(key);
      explored++;
      await onSchedule?.({ index: explored, choices, preemptions: preemptionCount(ds) }, result);

      let before = preemptionCount(ds.slice(0, prefix.length));
      for (let i = prefix.length; i < ds.length; i++) {
        const d = ds[i]!;
        const last = i > 0 ? ds[i - 1]!.chosen : undefined;
        for (const a of d.runnable) {
          if (a === d.chosen) continue;
          const preempt = last !== undefined && d.runnable.includes(last) && a !== last;
          const pc = before + (preempt ? 1 : 0);
          if (pc > opts.maxPreemptions) continue;
          const next = [...choices.slice(0, i), a];
          const nk = next.join(',');
          if (queued.has(nk)) continue;
          queued.add(nk);
          buckets[pc]!.push(next);
        }
        before += d.preemption ? 1 : 0;
      }
    }
  }
  return { explored, duplicates, stoppedBy, exhaustive: stoppedBy === 'complete', maxPreemptions: opts.maxPreemptions, strategy: 'dfs' };
}

export interface RandomOptions {
  runs: number;
  seed: number;
  timeBudgetMs?: number;
}

export interface RandomSummary {
  explored: number;
  distinct: number;
  stoppedBy: StoppedBy;
  exhaustive: false;
  seed: number;
  strategy: 'random';
}

/** Seeded random scheduling: `runs` executions, each decision picked uniformly among runnable actors. */
export async function exploreRandom<R extends { decisions: Decision[] }>(
  exec: Executor<R>,
  opts: RandomOptions,
  clock: Clock,
  onSchedule?: OnSchedule<R>,
): Promise<RandomSummary> {
  const rng = mulberry32(opts.seed);
  const start = clock.now();
  const seen = new Set<string>();
  let explored = 0;
  let stoppedBy: StoppedBy = 'complete';
  while (explored < opts.runs) {
    if (opts.timeBudgetMs !== undefined && clock.now() - start >= opts.timeBudgetMs) { stoppedBy = 'time-budget'; break; }
    const result = await exec(randomChooser(rng));
    const choices = result.decisions.map((d) => d.chosen);
    seen.add(choices.join(','));
    explored++;
    await onSchedule?.({ index: explored, choices, preemptions: preemptionCount(result.decisions) }, result);
  }
  return { explored, distinct: seen.size, stoppedBy, exhaustive: false, seed: opts.seed, strategy: 'random' };
}
