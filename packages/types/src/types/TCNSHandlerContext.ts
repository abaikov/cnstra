import { TCNSLocalContextValueStore } from './TCNSLocalContextValueStore';
import { ICNS } from '../interfaces/ICNS';

/**
 * The base `ctx` bag handed to every dendrite handler — nothing app-specific
 * lives here. Factory layers add their own fields via the `TExt` extension
 * (see {@link TCNSHandlerContext}), so the base stays clean for neurons that
 * don't opt into anything.
 */
export type TCNSHandlerContextBase<TContextValue> =
    TCNSLocalContextValueStore<TContextValue> & {
        abortSignal?: AbortSignal;
        cns?: ICNS<any, any>;
        stimulation?: any;
        /**
         * The caller-supplied value passed as `stimulate(sig, { stimulationContext })`
         * (or `activate(...)`) — the same object on every hop of this stimulation, in
         * any environment (sync or async, node or browser). Use it to correlate logs
         * to a run: pass `{ stimulationId, attemptNumber }` and read it here. Typed
         * `unknown` because the neuron doesn't own the shape — the caller does; cast at
         * the read site.
         */
        stimulationContext?: unknown;
    };

/**
 * The `ctx` a dendrite handler receives. `TExt` is whatever the factory layers
 * poured in (e.g. `withGlobal<T>()` adds `{ global: T }`) — it's a plain
 * intersection, so layers add exactly what they want and nothing else, and a
 * base neuron (no layers) gets `TExt = unknown`, i.e. just the base bag.
 *
 * The handler signature stays `(payload, axon, ctx)` no matter how many layers
 * you stack; each layer widens the type of `ctx`, never the argument list.
 */
export type TCNSHandlerContext<TContextValue, TExt = unknown> =
    TCNSHandlerContextBase<TContextValue> & TExt;
