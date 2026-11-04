function isPlainObject(value: object): boolean {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function isCNSHomeostatSameValue(previous: unknown, next: unknown): boolean {
    if (previous === next) return true;
    if (typeof previous !== 'object' || typeof next !== 'object' || previous === null || next === null) {
        return typeof previous === 'number' && typeof next === 'number' && Number.isNaN(previous) && Number.isNaN(next);
    }
    if (Array.isArray(previous) || Array.isArray(next)) {
        if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
        for (let i = 0; i < previous.length; i++) {
            if (!isCNSHomeostatSameValue(previous[i], next[i])) return false;
        }
        return true;
    }
    if (!isPlainObject(previous) || !isPlainObject(next)) return false;
    const previousKeys = Object.keys(previous);
    if (previousKeys.length !== Object.keys(next).length) return false;
    for (const key of previousKeys) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
        if (!isCNSHomeostatSameValue(Reflect.get(previous, key), Reflect.get(next, key))) return false;
    }
    return true;
}
