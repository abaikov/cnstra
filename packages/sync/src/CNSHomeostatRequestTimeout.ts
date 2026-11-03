export class CNSHomeostatRequestTimeout {
    private readonly timeoutMs: number;

    public constructor(timeoutMs: number, ownerName: string) {
        if (!(timeoutMs > 0) || (timeoutMs !== Infinity && timeoutMs > 2 ** 31 - 1)) {
            throw new Error(`${ownerName}: timeoutMs ${timeoutMs} is not a period a timer can wait; give one above 0 and at most ${2 ** 31 - 1}, or Infinity to never time out`);
        }
        this.timeoutMs = timeoutMs;
    }

    public signalOf(abortSignal: AbortSignal | undefined, describeRequest: () => string): { signal: AbortSignal; clear: () => void } {
        if (this.timeoutMs === Infinity) return { signal: abortSignal ?? new AbortController().signal, clear: () => undefined };
        const timeoutController = new AbortController();
        const timeout = setTimeout(
            () => timeoutController.abort(new DOMException(`${describeRequest()}: timed out after ${this.timeoutMs} ms`, 'TimeoutError')),
            this.timeoutMs
        );
        if (typeof timeout === 'object' && timeout !== null && 'unref' in timeout && typeof timeout.unref === 'function') timeout.unref();
        return {
            signal: abortSignal === undefined ? timeoutController.signal : AbortSignal.any([abortSignal, timeoutController.signal]),
            clear: () => clearTimeout(timeout),
        };
    }
}
