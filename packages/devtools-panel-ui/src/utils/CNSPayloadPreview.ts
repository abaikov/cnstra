export class CNSPayloadPreview {
    public static textOf(payload: unknown, maxLength: number, isPretty: boolean): string {
        if (payload === undefined) return '—';
        try {
            const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, isPretty ? 2 : undefined);
            if (text === undefined) return 'null';
            return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
        } catch {
            return String(payload);
        }
    }
}
