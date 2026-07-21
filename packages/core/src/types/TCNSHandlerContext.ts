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
