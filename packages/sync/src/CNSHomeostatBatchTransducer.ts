import type { TCNSHomeostatBatchTransducerOptions } from './types/TCNSHomeostatBatchTransducerOptions';
import type { TCNSHomeostatBatchTransduction } from './types/TCNSHomeostatBatchTransduction';
import type { TCNSHomeostatTransductionRow } from './types/TCNSHomeostatTransductionRow';
import { hashCNSHomeostatKey } from './utils/hashCNSHomeostatKey';
import { hashCNSHomeostatTransductionRequest } from './utils/hashCNSHomeostatTransductionRequest';

export class CNSHomeostatBatchTransducer {
    private readonly batchTransduceFn: TCNSHomeostatBatchTransducerOptions['batchTransduceFn'];

    private readonly batchScheduleFn: (sendBatch: () => void) => void;

    private batchTransductionByRequestHash = new Map<string, TCNSHomeostatBatchTransduction>();

    public constructor(options: TCNSHomeostatBatchTransducerOptions) {
        this.batchTransduceFn = options.batchTransduceFn;
        this.batchScheduleFn = options.batchScheduleFn ?? (sendBatch => { setTimeout(sendBatch, 0); });
    }

    public transduceOf<TKey extends readonly unknown[], TData>(
        name: string,
        parse: (values: readonly unknown[]) => TData
    ): (key: TKey, abortSignal: AbortSignal) => Promise<TData> {
        return (key, abortSignal) => new Promise<TData>((resolve, reject) => {
            if (abortSignal.aborted) {
                reject(abortSignal.reason);
                return;
            }
            const requestHash = hashCNSHomeostatTransductionRequest(name, key);
            let batchTransduction = this.batchTransductionByRequestHash.get(requestHash);
            const isBatchStarting = this.batchTransductionByRequestHash.size === 0;
            if (batchTransduction === undefined) {
                batchTransduction = { homeostatTransductionRequest: { name, key }, waiters: [] };
                this.batchTransductionByRequestHash.set(requestHash, batchTransduction);
            }
            batchTransduction.waiters.push({
                abortSignal,
                answer: values => {
                    try {
                        resolve(parse(values));
                    } catch (error) {
                        reject(error);
                    }
                },
                reject,
            });
            if (!isBatchStarting) return;
            try {
                this.batchScheduleFn(() => this.sendBatch());
            } catch (error) {
                this.batchTransductionByRequestHash = new Map();
                reject(error);
            }
        });
    }

    private sendBatch(): void {
        const batchTransductions: TCNSHomeostatBatchTransduction[] = [];
        for (const batchTransduction of this.batchTransductionByRequestHash.values()) {
            const waiters = batchTransduction.waiters.filter(waiter => {
                if (!waiter.abortSignal.aborted) return true;
                waiter.reject(waiter.abortSignal.reason);
                return false;
            });
            if (waiters.length > 0) batchTransductions.push({ homeostatTransductionRequest: batchTransduction.homeostatTransductionRequest, waiters });
        }
        this.batchTransductionByRequestHash = new Map();
        if (batchTransductions.length === 0) return;
        const abortController = new AbortController();
        let liveWaiterCount = 0;
        const removeAbortListeners: (() => void)[] = [];
        for (const batchTransduction of batchTransductions) {
            for (const waiter of batchTransduction.waiters) {
                liveWaiterCount++;
                const onAbort = () => {
                    waiter.reject(waiter.abortSignal.reason);
                    liveWaiterCount--;
                    if (liveWaiterCount === 0) abortController.abort();
                };
                waiter.abortSignal.addEventListener('abort', onAbort, { once: true });
                removeAbortListeners.push(() => waiter.abortSignal.removeEventListener('abort', onAbort));
            }
        }
        let transduced: Promise<readonly TCNSHomeostatTransductionRow[]>;
        try {
            transduced = this.batchTransduceFn(batchTransductions.map(batchTransduction => batchTransduction.homeostatTransductionRequest), abortController.signal);
        } catch (error) {
            transduced = Promise.reject(error);
        }
        transduced.then(
            homeostatTransductionRows => {
                for (const removeAbortListener of removeAbortListeners) removeAbortListener();
                const valuesByRequestHash = new Map<string, unknown[]>();
                const errorByRequestHash = new Map<string, unknown>();
                for (const homeostatTransductionRow of homeostatTransductionRows) {
                    const requestHash = hashCNSHomeostatTransductionRequest(homeostatTransductionRow.name, homeostatTransductionRow.key);
                    if ('error' in homeostatTransductionRow) {
                        if (!errorByRequestHash.has(requestHash)) errorByRequestHash.set(requestHash, homeostatTransductionRow.error);
                        continue;
                    }
                    let values = valuesByRequestHash.get(requestHash);
                    if (values === undefined) {
                        values = [];
                        valuesByRequestHash.set(requestHash, values);
                    }
                    if ('data' in homeostatTransductionRow) values.push(homeostatTransductionRow.data);
                }
                for (const batchTransduction of batchTransductions) {
                    const { name, key } = batchTransduction.homeostatTransductionRequest;
                    const requestHash = hashCNSHomeostatTransductionRequest(name, key);
                    const values = valuesByRequestHash.get(requestHash);
                    for (const waiter of batchTransduction.waiters) {
                        if (waiter.abortSignal.aborted) continue;
                        if (errorByRequestHash.has(requestHash)) waiter.reject(errorByRequestHash.get(requestHash));
                        else if (values === undefined) waiter.reject(new Error(`homeostat transduction: ${name} ${hashCNSHomeostatKey(key)} was not answered`));
                        else waiter.answer(values);
                    }
                }
            },
            error => {
                for (const removeAbortListener of removeAbortListeners) removeAbortListener();
                for (const batchTransduction of batchTransductions) {
                    for (const waiter of batchTransduction.waiters) if (!waiter.abortSignal.aborted) waiter.reject(error);
                }
            }
        );
    }
}
