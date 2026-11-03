export class CNSJobJsonValue {
    static text(value: unknown): string | undefined {
        if (value === undefined) return undefined;
        const text = JSON.stringify(value);
        if (text === undefined) throw new TypeError('value has no JSON representation');
        if (/(^|[^\\])(\\\\)*\\u0000/.test(text)) throw new TypeError('value contains a NUL character, which Postgres cannot store');
        return text;
    }

    static copy<TValue>(value: TValue): TValue {
        const text = CNSJobJsonValue.text(value);
        return text === undefined ? value : (JSON.parse(text) as TValue);
    }
}
