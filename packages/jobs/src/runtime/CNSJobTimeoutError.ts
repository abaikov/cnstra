export class CNSJobTimeoutError extends Error {
    constructor(readonly timeoutMs: number) {
        super(`job attempt exceeded its timeout of ${timeoutMs} ms`);
        this.name = 'TimeoutError';
    }
}
