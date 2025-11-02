/**
 * Safe JSON serialization that handles circular references and non-serializable objects
 * Similar to the safeJson function in @cnstra/devtools SDK
 */
export function safeJson(
    value: unknown,
    seen = new WeakSet<object>()
): unknown {
    if (value === null) return null;
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    )
        return value;
    if (value instanceof Error)
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    if (Array.isArray(value)) return value.map(v => safeJson(v, seen));
    if (typeof value === 'object') {
        if (!value) return value;
        if (seen.has(value as object)) return '[Circular]';
        seen.add(value as object);
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const sv = safeJson(v, seen);
            if (sv !== undefined) out[k] = sv;
        }
        return out;
    }
    // Handle non-serializable values
    if (typeof value === 'function' || typeof value === 'symbol') {
        return '[Non-serializable]';
    }
    return value;
}

/**
 * Safe JSON stringify that handles circular references and non-serializable objects
 */
export function safeStringify(value: unknown, space?: string | number): string {
    try {
        const safeValue = safeJson(value);
        return JSON.stringify(safeValue, null, space);
    } catch (e) {
        return String(value);
    }
}
