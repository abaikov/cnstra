import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
import type { ICNSStimulationWriter } from './interfaces/ICNSStimulationRepository';

/** One record on its way to a store, tagged so a link can tell them apart. */
export type TCNSStimulationWrite =
    | { kind: 'stimulation'; record: TCNSStimulationState }
    | { kind: 'attempt'; record: TCNSStimulationAttempt }
    | { kind: 'task'; record: TCNSStimulationTask };

/**
 * One link in the write path.
 *
 * Call `next()` to pass the write on; return without calling it to drop it.
 * The record is a plain value by the time it gets here — the frontier was
 * already snapshotted off the live run — so a link may retry it, delay it, edit
 * it or send it somewhere else without any risk of reading state that has since
 * moved on. That is exactly why the chain belongs HERE and not on the response
 * listener, where two links would snapshot two different frontiers for one hop.
 */
export type TCNSStimulationWriteMiddleware = (
    write: TCNSStimulationWrite,
    next: () => Promise<void>
) => Promise<void>;

/**
 * Compose links in front of a store. The result is an ordinary
 * {@link ICNSStimulationWriter}, so it drops into `repository` wherever a store
 * goes — including inside a {@link CNSFanOutStimulationWriter} branch.
 *
 * ```ts
 * withCNSWriteChain([retryCNSWrites({ attempts: 3 }), redactCNSPayload(['card'])], store)
 * ```
 *
 * Reads are not part of the chain: `getStimulation` goes straight to the store,
 * because a link that rewrote a record on the way in has no business rewriting
 * what resume reads back out.
 */
export const withCNSWriteChain = (
    chain: readonly TCNSStimulationWriteMiddleware[],
    store: ICNSStimulationWriter
): ICNSStimulationWriter => {
    const dispatch = async (write: TCNSStimulationWrite): Promise<void> => {
        const step = async (index: number): Promise<void> => {
            if (index === chain.length) {
                if (write.kind === 'stimulation')
                    return store.saveStimulation(write.record);
                if (write.kind === 'attempt')
                    return store.saveAttempt(write.record);
                return store.appendTask(write.record);
            }

            // `next()` may be called more than once, unlike in the DevTools
            // action chain: replaying the tail IS how a retry link works, and it
            // is safe because these writes are idempotent by construction — a
            // stimulation and an attempt are upserts by id, a task is keyed by
            // `(stimulationAttemptId, index)`.
            await chain[index](write, () => step(index + 1));
        };

        await step(0);
    };

    return {
        saveStimulation: record => dispatch({ kind: 'stimulation', record }),
        saveAttempt: record => dispatch({ kind: 'attempt', record }),
        appendTask: record => dispatch({ kind: 'task', record }),
        getStimulation: id => store.getStimulation(id),
    };
};

export type TCNSRetryWritesOptions = {
    /** Total tries including the first. Default 3. */
    attempts?: number;
    /** Delay before the first retry, doubled each time. Default 50ms. */
    delayMs?: number;
    /** Called for every failed try, including the last. */
    onError?: (error: unknown, attempt: number) => void;
};

/**
 * Retry a failing write with exponential backoff.
 *
 * Safe to retry because the writes are idempotent by construction: a stimulation
 * and an attempt are upserts by id, and a task is keyed by
 * `(stimulationAttemptId, index)` — replaying one cannot duplicate a row.
 *
 * After the last try the error is rethrown, so a barrier run still fails and a
 * fire-and-forget one still reports. Swallowing it here would turn a store
 * outage into silence.
 */
export const retryCNSWrites = (
    options: TCNSRetryWritesOptions = {}
): TCNSStimulationWriteMiddleware => {
    const attempts = Math.max(1, options.attempts ?? 3);
    const delayMs = options.delayMs ?? 50;

    return async (_write, next) => {
        let lastError: unknown;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await next();
                return;
            } catch (error) {
                lastError = error;
                options.onError?.(error, attempt);
                if (attempt === attempts) break;
                await new Promise(resolve =>
                    setTimeout(resolve, delayMs * 2 ** (attempt - 1))
                );
            }
        }

        throw lastError;
    };
};

/**
 * Replace the value at each named key inside a record's payloads.
 *
 * Payloads reach the store verbatim, so anything a signal carries — a card
 * number, a token, a customer's address — is written and then shown in the panel
 * to whoever can open it. This is the seam that keeps it out, and it works on a
 * copy: the live signal the run is still using is never touched.
 *
 * Keys are matched at any depth by name, which is deliberately blunt: a
 * redaction that misses is worse than one that over-redacts.
 */
export const redactCNSPayload = (
    keys: readonly string[],
    replacement: unknown = '[redacted]'
): TCNSStimulationWriteMiddleware => {
    const secret = new Set(keys);

    const scrub = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(scrub);
        if (!value || typeof value !== 'object') return value;

        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(
            value as Record<string, unknown>
        )) {
            out[key] = secret.has(key) ? replacement : scrub(inner);
        }
        return out;
    };

    return (write, next) => {
        if (write.kind === 'task' && write.record.output) {
            write.record = {
                ...write.record,
                output: {
                    ...write.record.output,
                    payload: scrub(write.record.output.payload),
                },
            };
        } else if (write.kind === 'stimulation') {
            write.record = {
                ...write.record,
                entry: {
                    ...write.record.entry,
                    payload: scrub(write.record.entry.payload),
                },
            };
        } else if (write.kind === 'attempt') {
            write.record = {
                ...write.record,
                entry: write.record.entry.map(signal => ({
                    ...signal,
                    payload: scrub(signal.payload),
                })),
            };
        }

        return next();
    };
};

/**
 * Drop a payload that serializes past `maxBytes`, keeping the record.
 *
 * A single fat payload — a document, an image, a large API response — is written
 * on every hop that carries it, and a store has no opinion about that until it
 * falls over. Losing the payload and keeping the run's shape is the better half
 * of that trade; `replacement` marks where it happened so nobody hunts a bug in
 * data that was never stored.
 */
export const capCNSPayload = (
    maxBytes: number,
    replacement: unknown = '[dropped: too large]'
): TCNSStimulationWriteMiddleware => {
    const tooBig = (payload: unknown): boolean => {
        if (payload === undefined || payload === null) return false;
        try {
            return JSON.stringify(payload).length > maxBytes;
        } catch {
            // Not serializable at all — the store would reject it anyway.
            return true;
        }
    };

    return (write, next) => {
        if (write.kind === 'task' && write.record.output) {
            if (tooBig(write.record.output.payload)) {
                write.record = {
                    ...write.record,
                    output: {
                        ...write.record.output,
                        payload: replacement,
                    },
                };
            }
        } else if (write.kind === 'stimulation') {
            if (tooBig(write.record.entry.payload)) {
                write.record = {
                    ...write.record,
                    entry: { ...write.record.entry, payload: replacement },
                };
            }
        } else if (write.kind === 'attempt') {
            // An attempt's entry is the frontier a resume was activated with, so
            // it carries payloads too — capping the other two and not this one
            // would let the same fat value through by another door.
            if (write.record.entry.some(signal => tooBig(signal.payload))) {
                write.record = {
                    ...write.record,
                    entry: write.record.entry.map(signal =>
                        tooBig(signal.payload)
                            ? { ...signal, payload: replacement }
                            : signal
                    ),
                };
            }
        }

        return next();
    };
};
