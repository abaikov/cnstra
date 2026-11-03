export class CNSJobCompositeKey {
    static of(...parts: ReadonlyArray<string | number>): string {
        return parts.join('\u001f');
    }
}
