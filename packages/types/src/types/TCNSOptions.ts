/**
 * Options bag for `new CNS(...)`. Currently empty — the former
 * `autoCleanupContexts` flag was removed together with the per-neuron mutable
 * context store. Kept as a named type so the constructor signature and future
 * engine-level options have a stable home.
 */
export type TCNSOptions = Record<never, never>;
