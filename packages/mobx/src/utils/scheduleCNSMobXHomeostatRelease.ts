import { CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS } from './CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS';

export function scheduleCNSMobXHomeostatRelease(keepMs: number, release: () => void): () => void {
    if (keepMs === Infinity) return () => {};
    if (keepMs <= 0) {
        let isCancelled = false;
        queueMicrotask(() => {
            if (!isCancelled) release();
        });
        return () => { isCancelled = true; };
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = (remainingMs: number): void => {
        const delayMs = Math.min(remainingMs, CNS_MOBX_HOMEOSTAT_MAX_TIMEOUT_MS);
        timeout = setTimeout(() => {
            if (remainingMs > delayMs) armTimeout(remainingMs - delayMs);
            else release();
        }, delayMs);
        (timeout as { unref?: () => void }).unref?.();
    };
    armTimeout(keepMs);
    return () => clearTimeout(timeout);
}
