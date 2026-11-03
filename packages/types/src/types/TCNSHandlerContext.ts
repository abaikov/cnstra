import { TCNSContextStore } from './TCNSContextStore';
import { ICNS } from '../interfaces/ICNS';

/**
 * The base `ctx` bag handed to every dendrite handler — nothing app-specific
 * lives here. Factory layers add their own fields via the `TExt` extension
 * (see {@link TCNSHandlerContext}), so the base stays clean for neurons that
 * don't opt into anything.
 *
 * Internal building block for {@link TCNSHandlerContext} — not part of the public API.
 */
type TCNSHandlerContextBase = {
    abortSignal?: AbortSignal;
    cns?: ICNS<any, any>;
    stimulation?: any;
    /**
     * The context store of the whole run — what the caller passed as
     * `stimulate(sig, { stimulationContext })` plus whatever the run has written
     * into it since, the same object on every hop in any environment (sync or
     * async, node or browser). Keyed by namespace; the values inside are
     * `unknown`, so cast at the read site.
     */
    stimulationContext?: TCNSContextStore;
    /**
     * The context store of the activation currently running — data a response
     * listener attached to THIS activation before it started. Unset when nobody
     * wrote anything.
     *
     * Same shape as {@link stimulationContext}, shorter life: this one is gone
     * when the activation returns.
     */
    activationContext?: TCNSContextStore;
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
export type TCNSHandlerContext<TExt = unknown> = TCNSHandlerContextBase & TExt;
