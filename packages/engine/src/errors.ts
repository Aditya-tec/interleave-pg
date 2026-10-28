export { UnsafeTargetError } from './guard.js';

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedError';
  }
}

export class NoStatementsError extends Error {
  constructor(
    message = "no statements intercepted: pg resolution mismatch? interleave-pg cannot see database calls that do not go through the app's pg package (for example Prisma's query engine, or a second copy of pg), so it cannot say anything about this code",
  ) {
    super(message);
    this.name = 'NoStatementsError';
  }
}

export class StallError extends Error {
  constructor(actor: string) {
    super(`actor "${actor}" stalled outside the database; stub external calls in the scenario`);
    this.name = 'StallError';
  }
}

/** Bad scenario file / usage: exit code 2. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioError';
  }
}
