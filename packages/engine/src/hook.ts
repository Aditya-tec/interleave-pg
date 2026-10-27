import { AsyncResource } from 'node:async_hooks';
import net from 'node:net';
import { als } from './actor-context.js';
import type { Controller, Outcome } from './controller.js';
import { assertClientEndpoint, checkClientParams, UnsafeTargetError, type Target } from './guard.js';
import { BYPASS, type PgModule } from './pg-load.js';

export interface HookState {
  target: Target;
  controller: Controller | null;
  /** First UnsafeTargetError seen; the runner fails the run with it. */
  unsafe: UnsafeTargetError | null;
  /** Every client that has issued a statement while the hook was installed. */
  clients: Set<any>;
  warnings: Set<string>;
  untracked: number;
}

const SEEN = Symbol('raceproof.seen');
const PREPARED = Symbol('raceproof.prepared');

export function newHookState(target: Target): HookState {
  return { target, controller: null, unsafe: null, clients: new Set(), warnings: new Set(), untracked: 0 };
}

export interface Hook {
  /** Original, unpatched Client.prototype.query. */
  original: (...a: any[]) => any;
  uninstall(): void;
  /** Applies per-connection safety settings once per client (engine-internal, ungated). */
  prepareClient(client: any, settings: string): Promise<void>;
}

export function installHook(pg: PgModule, state: HookState): Hook {
  const proto = pg.Client.prototype;
  const original = proto.query;
  const originalConnect = proto.connect;

  /** Layer 1: runs before any socket is opened. */
  function patchedConnect(this: any, ...args: any[]): any {
    if (this[BYPASS]) return originalConnect.apply(this, args);
    try {
      assertClientEndpoint(state.target, this, net);
    } catch (e) {
      state.unsafe ??= e as UnsafeTargetError;
      state.controller?.abort(e as Error);
      const cb = args[0];
      if (typeof cb === 'function') {
        process.nextTick(cb, e);
        return undefined;
      }
      return Promise.reject(e);
    }
    return originalConnect.apply(this, args);
  }

  function patched(this: any, ...args: any[]): any {
    if (this[BYPASS]) return original.apply(this, args);

    // S2: every hooked client must point at the allowed target, before anything is sent.
    try {
      checkClientParams(state.target, { host: this.host, port: this.port, database: this.database });
    } catch (e) {
      state.unsafe ??= e as UnsafeTargetError;
      state.controller?.abort(e as Error);
      throw e;
    }
    if (!this[SEEN]) {
      this[SEEN] = true;
      state.clients.add(this);
      this.on('error', () => {}); // never let an idle-client error crash the engine
    }

    const first = args[0];
    const text: string | undefined =
      typeof first === 'string' ? first : first && typeof first.text === 'string' && typeof first.submit !== 'function' ? first.text : undefined;
    if (text === undefined) {
      state.warnings.add('unsupported statement object (cursor / stream / Submittable) passed through ungated');
      return original.apply(this, args);
    }
    const store = als.getStore();
    const controller = state.controller;
    if (!store || !controller) {
      if (controller) {
        state.untracked++;
        state.warnings.add(`untracked statement outside any actor passed through ungated: ${text.slice(0, 60)}`);
      }
      return original.apply(this, args);
    }
    if (/^\s*(copy|listen|notify)\b/i.test(text)) {
      state.warnings.add(`${text.trim().split(/\s+/)[0]!.toUpperCase()} is not gated (unsupported)`);
      return original.apply(this, args);
    }

    const values: unknown[] | undefined = typeof first === 'string' ? (Array.isArray(args[1]) ? args[1] : undefined) : first.values;
    const lastArg = args[args.length - 1];
    const cb: ((err: any, res?: any) => void) | undefined = typeof lastArg === 'function' ? AsyncResource.bind(lastArg) : undefined;
    const callArgs = cb ? args.slice(0, -1) : args;

    const execute = (): Promise<Outcome> =>
      new Promise((resolve) => {
        try {
          if (cb) {
            original.apply(this, [...callArgs, (err: any, res: any) => resolve(err ? { ok: false, error: err } : { ok: true, result: res })]);
          } else {
            Promise.resolve(original.apply(this, callArgs)).then(
              (res: any) => resolve({ ok: true, result: res }),
              (error: any) => resolve({ ok: false, error }),
            );
          }
        } catch (error) {
          resolve({ ok: false, error });
        }
      });

    const gated = controller.gate(store.actor, this, { sql: text, params: values }, execute);
    if (cb) {
      gated.then((o) => (o.ok ? cb(null, o.result) : cb(o.error)));
      return undefined;
    }
    return gated.then((o) => {
      if (o.ok) return o.result;
      throw o.error;
    });
  }

  proto.query = patched;
  proto.connect = patchedConnect;

  return {
    original,
    uninstall() {
      if (proto.query === patched) proto.query = original;
      if (proto.connect === patchedConnect) proto.connect = originalConnect;
    },
    async prepareClient(client: any, settings: string) {
      if (client[PREPARED]) return;
      client[PREPARED] = true;
      await original.call(client, settings);
    },
  };
}
