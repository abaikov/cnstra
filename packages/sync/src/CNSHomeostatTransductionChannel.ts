import type { ICNSHomeostatTransductionCodec } from './interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionChannelOptions } from './types/TCNSHomeostatTransductionChannelOptions';
import type { TCNSHomeostatTransductionChannelResponse } from './types/TCNSHomeostatTransductionChannelResponse';
import type { TCNSHomeostatTransductionRequest } from './types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from './types/TCNSHomeostatTransductionRow';
import { CNSHomeostatTransductionQueryCodec } from './CNSHomeostatTransductionQueryCodec';
import { CNSHomeostatRequestTimeout } from './CNSHomeostatRequestTimeout';
import { splitCNSHomeostatTransductionRequests } from './utils/splitCNSHomeostatTransductionRequests';

export class CNSHomeostatTransductionChannel {
    private readonly sendRequest: TCNSHomeostatTransductionChannelOptions['sendRequest'];

    private readonly homeostatTransductionCodec: ICNSHomeostatTransductionCodec;

    private readonly homeostatRequestTimeout: CNSHomeostatRequestTimeout;

    private readonly settlerByRequestId = new Map<string, { answer(homeostatTransductionChannelResponse: TCNSHomeostatTransductionChannelResponse): void; fail(error: unknown): void }>();

    private lastRequestNumber = 0;

    public constructor(options: TCNSHomeostatTransductionChannelOptions) {
        this.sendRequest = options.sendRequest;
        this.homeostatTransductionCodec = options.homeostatTransductionCodec ?? CNSHomeostatTransductionQueryCodec.INSTANCE;
        this.homeostatRequestTimeout = new CNSHomeostatRequestTimeout(options.timeoutMs ?? 30_000, 'homeostat transduction channel');
    }

    public readonly batchTransduceFn = async (
        homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[],
        abortSignal: AbortSignal
    ): Promise<readonly TCNSHomeostatTransductionRow[]> => {
        const homeostatTransductionCodec = this.homeostatTransductionCodec;
        const { refusedRows, encodableRequests } = splitCNSHomeostatTransductionRequests(homeostatTransductionCodec, homeostatTransductionRequests);
        if (encodableRequests.length === 0) return refusedRows;
        const encodedRequests = homeostatTransductionCodec.encodeRequests(encodableRequests);
        const requestId = String(++this.lastRequestNumber);
        const requestSignal = this.homeostatRequestTimeout.signalOf(abortSignal, () => `homeostat transduction channel request ${requestId}`);
        try {
            const homeostatTransductionChannelResponse = await this.exchange(requestId, encodedRequests, requestSignal.signal);
            if (homeostatTransductionChannelResponse.status !== 200) {
                throw Object.assign(new Error(`homeostat transduction channel request ${requestId}: status ${homeostatTransductionChannelResponse.status}`), {
                    status: homeostatTransductionChannelResponse.status,
                });
            }
            try {
                return [...refusedRows, ...homeostatTransductionCodec.decodeRows(homeostatTransductionChannelResponse.body, encodedRequests)];
            } catch (error) {
                throw Object.assign(new Error(`homeostat transduction channel request ${requestId}: the answer is not ${homeostatTransductionCodec.mediaType}`), { cause: error });
            }
        } catch (error) {
            if (abortSignal.aborted) throw error;
            return [...refusedRows, ...homeostatTransductionCodec.decodeRequests(encodedRequests).map(({ name, key }) => ({ name, key, error }))];
        } finally {
            this.settlerByRequestId.delete(requestId);
            requestSignal.clear();
        }
    };

    public receiveResponse(homeostatTransductionChannelResponse: TCNSHomeostatTransductionChannelResponse): void {
        this.settlerByRequestId.get(homeostatTransductionChannelResponse.requestId)?.answer(homeostatTransductionChannelResponse);
    }

    public failPendingRequests(error: unknown): void {
        for (const settler of [...this.settlerByRequestId.values()]) settler.fail(error);
    }

    private exchange(requestId: string, encodedRequests: string, signal: AbortSignal): Promise<TCNSHomeostatTransductionChannelResponse> {
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(signal.reason);
                return;
            }
            const onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            this.settlerByRequestId.set(requestId, {
                answer: homeostatTransductionChannelResponse => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(homeostatTransductionChannelResponse);
                },
                fail: error => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                },
            });
            try {
                this.sendRequest({ requestId, mediaType: this.homeostatTransductionCodec.mediaType, encodedRequests });
            } catch (error) {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            }
        });
    }
}
