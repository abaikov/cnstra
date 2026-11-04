export class CNSLocationHash {
    public static read(): string {
        return 'location' in globalThis ? globalThis.location.hash : '';
    }

    public static write(hash: string): void {
        if ('location' in globalThis) globalThis.location.hash = hash;
    }
}
