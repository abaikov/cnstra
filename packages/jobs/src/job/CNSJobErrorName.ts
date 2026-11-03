export class CNSJobErrorName {
    static of(error: unknown): string {
        if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string') return error.name;
        return 'Error';
    }
}
