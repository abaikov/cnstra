/**
 * A structured copy of what survives a process boundary.
 *
 * Kept: plain objects, arrays, strings, numbers, booleans, `null`, and anything
 * with a `toJSON()` (a `Date`, a `URL`). Left behind: functions, symbols,
 * `undefined`, class instances the storage layer could not rebuild anyway, and
 * anything reachable only through a cycle.
 *
 * Dropped silently, on purpose. This runs on the frontier checkpoint — including
 * the one inside the `catch` that is already failing a run — so throwing here
 * would let a value someone attached for observability destroy the run and its
 * resume point. A browser form and `structuredClone` take the same position:
 * carry what can be carried, leave the rest.
 *
 * The contract for a caller is therefore one line: what is portable travels, a
 * live handle does not. An integration that needs both keeps the live handle and
 * a portable form of it side by side under its own key.
 */
export function portable(value: unknown): unknown {
    return copy(value, new WeakSet<object>());
}

/** True when `value` came back from `portable()` carrying nothing. */
export const isEmptyContext = (
    value: Record<string, unknown> | undefined
): boolean => !value || Object.keys(value).length === 0;

function copy(value: unknown, seen: WeakSet<object>): unknown {
    if (value === null) return null;

    const type = typeof value;
    if (type === 'string' || type === 'boolean') return value;
    if (type === 'number') {
        // NaN and the infinities become `null` in JSON. Dropping them here keeps
        // what is stored and what is read back the same value.
        return Number.isFinite(value) ? value : undefined;
    }
    if (type === 'bigint') {
        // `JSON.stringify` throws on a bigint rather than dropping it — which is
        // exactly the failure this function exists to prevent.
        return undefined;
    }
    if (type !== 'object') return undefined; // function, symbol, undefined

    const object = value as object;
    if (seen.has(object)) return undefined; // a cycle: unreachable on the far side
    seen.add(object);
    try {
        // A `toJSON()` is the object's own statement of how it crosses. Trust it,
        // then copy what it returned — it can hand back anything.
        const toJSON = (object as { toJSON?: unknown }).toJSON;
        if (typeof toJSON === 'function') {
            return copy((toJSON as () => unknown).call(object), seen);
        }

        if (Array.isArray(object)) {
            // A hole and a dropped element both read back as null through JSON,
            // so the array keeps its length rather than silently shifting.
            return object.map(item => {
                const copied = copy(item, seen);
                return copied === undefined ? null : copied;
            });
        }

        if (!isPlainObject(object)) return undefined;

        const out: Record<string, unknown> = {};
        // Own enumerable string keys only — symbol keys are dropped by
        // `JSON.stringify` too, and inherited ones are not data.
        const keys = Object.keys(object);
        for (const key of keys) {
            const copied = copy((object as Record<string, unknown>)[key], seen);
            if (copied !== undefined) out[key] = copied;
        }
        // An object that HAD content and lost all of it is dropped rather than
        // stored as `{}`: an empty object on the far side reads as "this was
        // carried and it was empty", which is a different and false statement.
        // One that was empty to begin with is carried — that is real data.
        if (keys.length > 0 && Object.keys(out).length === 0) return undefined;
        return out;
    } finally {
        // Released so the same object appearing twice side by side is copied
        // twice — only a genuine cycle is unreachable.
        seen.delete(object);
    }
}

/**
 * A bag of data rather than an instance of something. A class instance would not
 * come back as itself on the far side, so carrying its fields would be a lie
 * about what was restored.
 */
function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
