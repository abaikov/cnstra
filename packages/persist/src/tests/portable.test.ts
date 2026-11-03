import { portable } from '.././portable';

/**
 * `portable()` runs on the frontier checkpoint — including the one inside the
 * `catch` that is already failing a run. So it must never throw, whatever was
 * attached to a context store, and it must never hand the storage layer
 * something `JSON.stringify` will choke on.
 *
 * The rule is the browser's: carry what can be carried, leave the rest.
 */

/** What actually survives storage — the check that matters. */
const storable = (value: unknown): unknown =>
    JSON.parse(JSON.stringify({ v: portable(value) })).v;

describe('portable', () => {
    it('keeps plain data unchanged', () => {
        const input = {
            s: 'text',
            n: 12,
            b: false,
            nil: null,
            list: [1, 'two', { three: 3 }],
            nested: { a: { b: { c: 'deep' } } },
        };
        expect(portable(input)).toEqual(input);
    });

    it('copies rather than aliases', () => {
        const input = { nested: { a: 1 } };
        const copied = portable(input) as typeof input;
        copied.nested.a = 2;
        expect(input.nested.a).toBe(1);
    });

    it('leaves behind what cannot be rebuilt on the far side', () => {
        const value = portable({
            keep: 'yes',
            fn: () => 'no',
            sym: Symbol('no'),
            undef: undefined,
        });
        expect(value).toEqual({ keep: 'yes' });
    });

    it('drops a symbol-keyed entry, like JSON does', () => {
        const key = Symbol('hidden');
        expect(portable({ [key]: 'no', keep: 'yes' })).toEqual({ keep: 'yes' });
    });

    it('does not throw on a cycle, and does not carry it', () => {
        const cyclic: Record<string, unknown> = { keep: 'yes' };
        cyclic.self = cyclic;

        expect(() => portable(cyclic)).not.toThrow();
        expect(portable(cyclic)).toEqual({ keep: 'yes' });
        // And what comes out is safe to store, which is the whole point.
        expect(() => JSON.stringify(portable(cyclic))).not.toThrow();
    });

    it('carries the same object twice when it is not a cycle', () => {
        // A shared reference is not a cycle: both copies are reachable.
        const shared = { id: 7 };
        expect(portable({ a: shared, b: shared })).toEqual({
            a: { id: 7 },
            b: { id: 7 },
        });
    });

    it('leaves a class instance behind rather than half-restoring it', () => {
        class Live {
            constructor(public readonly handle = 'socket') {}
        }
        expect(portable({ live: new Live(), keep: 1 })).toEqual({ keep: 1 });
    });

    it('honours toJSON, because that is the object own answer', () => {
        const at = new Date('2026-09-10T00:00:00.000Z');
        expect(portable({ at })).toEqual({ at: '2026-09-10T00:00:00.000Z' });
    });

    it('drops a bigint instead of letting JSON.stringify throw on it', () => {
        // Built rather than written as a literal: the package targets below
        // ES2020, where `10n` does not compile.
        const big = BigInt(10);
        expect(portable({ big, keep: 1 })).toEqual({ keep: 1 });
        expect(() => storable({ big })).not.toThrow();
    });

    it('drops NaN and the infinities rather than storing null for them', () => {
        // JSON turns these into `null`; a value that reads back as something else
        // is worse than a value that is absent.
        expect(portable({ nan: NaN, inf: Infinity, keep: 1 })).toEqual({
            keep: 1,
        });
    });

    it('keeps an array the same length when an element is dropped', () => {
        // Shifting the elements would silently change what index 2 means.
        expect(portable([1, () => 0, 3])).toEqual([1, null, 3]);
    });

    it('passes a live handle over without touching the rest of the compartment', () => {
        // The shape an integration writes: a live object beside its portable form.
        const compartment = {
            '@cnstra/persist-otel': {
                context: { spanObject: () => 'live' },
                traceparent: '00-abc-def-01',
            },
        };
        expect(portable(compartment)).toEqual({
            '@cnstra/persist-otel': { traceparent: '00-abc-def-01' },
        });
    });

    it('gives back undefined for a value that is nothing but unportable', () => {
        expect(portable(undefined)).toBeUndefined();
        expect(portable(() => 0)).toBeUndefined();
    });
});
