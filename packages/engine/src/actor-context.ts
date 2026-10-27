import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActorStore {
  actor: string;
  runId: number;
}

/** Each actor runs inside als.run(); a gated statement reads its actor id from here. */
export const als = new AsyncLocalStorage<ActorStore>();
