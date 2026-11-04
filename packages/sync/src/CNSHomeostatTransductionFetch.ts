import type { ICNSHomeostatTransductionCodec } from './interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionFetchOptions } from './types/TCNSHomeostatTransductionFetchOptions';
import type { TCNSHomeostatTransductionRequest } from './types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from './types/TCNSHomeostatTransductionRow';
import { CNSHomeostatTransductionQueryCodec } from './CNSHomeostatTransductionQueryCodec';
import { CNSHomeostatRequestTimeout } from './CNSHomeostatRequestTimeout';
import { splitCNSHomeostatTransductionRequests } from './utils/splitCNSHomeostatTransductionRequests';

export class CNSHomeostatTransductionFetch {
    private readonly url: string;

    private readonly homeostatTransductionCodec: ICNSHomeostatTransductionCodec;

    private readonly fetch: typeof globalThis.fetch;

    private readonly headers: Record<string, string>;

    private readonly maxUrlLength: number;

    private readonly homeostatRequestTimeout: CNSHomeostatRequestTimeout;

    public constructor(options: TCNSHomeostatTransductionFetchOptions) {
        if (/[?#]/.test(options.url)) throw new Error(`homeostat transduction fetch: the url '${options.url}' has a query or a fragment; the query belongs to the codec`);
        this.url = options.url;
        this.homeostatTransductionCodec = options.homeostatTransductionCodec ?? CNSHomeostatTransductionQueryCodec.INSTANCE;
        this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.headers = {
            ...Object.fromEntries(Object.entries(options.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'accept')),
            accept: this.homeostatTransductionCodec.mediaType,
        };
        this.maxUrlLength = options.maxUrlLength ?? 4_096;
        this.homeostatRequestTimeout = new CNSHomeostatRequestTimeout(options.timeoutMs ?? 30_000, 'homeostat transduction fetch');
    }

    public readonly batchTransduceFn = async (
        homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[],
        abortSignal: AbortSignal
    ): Promise<readonly TCNSHomeostatTransductionRow[]> => {
        const homeostatTransductionCodec = this.homeostatTransductionCodec;
        const { refusedRows, encodableRequests } = splitCNSHomeostatTransductionRequests(homeostatTransductionCodec, homeostatTransductionRequests);
        if (encodableRequests.length === 0) return refusedRows;
        const homeostatTransductionRowChunks = await Promise.all(this.encodeRequestChunks(encodableRequests).map(async encodedRequests => {
            const url = `${this.url}?${encodedRequests}`;
            const requestSignal = this.homeostatRequestTimeout.signalOf(abortSignal, () => `GET ${url}`);
            try {
                const response = await this.fetch(url, { method: 'GET', headers: this.headers, signal: requestSignal.signal });
                if (!response.ok) throw Object.assign(new Error(`GET ${url}: HTTP ${response.status}`), { status: response.status });
                const encodedRows = await response.text();
                try {
                    return homeostatTransductionCodec.decodeRows(encodedRows, encodedRequests);
                } catch (error) {
                    throw Object.assign(new Error(`GET ${url}: the answer is not ${homeostatTransductionCodec.mediaType}`), { cause: error });
                }
            } catch (error) {
                if (abortSignal.aborted) throw error;
                return homeostatTransductionCodec.decodeRequests(encodedRequests).map(({ name, key }) => ({ name, key, error }));
            } finally {
                requestSignal.clear();
            }
        }));
        return [...refusedRows, ...homeostatTransductionRowChunks.flat()];
    };

    private encodeRequestChunks(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): string[] {
        const maxEncodedRequestsLength = this.maxUrlLength - this.url.length - 1;
        const encodedRequests = this.homeostatTransductionCodec.encodeRequests(homeostatTransductionRequests);
        if (encodedRequests.length <= maxEncodedRequestsLength) return [encodedRequests];
        const homeostatTransductionRequestByEncodedRequest = new Map<string, TCNSHomeostatTransductionRequest>();
        for (const homeostatTransductionRequest of homeostatTransductionRequests) {
            homeostatTransductionRequestByEncodedRequest.set(this.homeostatTransductionCodec.encodeRequests([homeostatTransductionRequest]), homeostatTransductionRequest);
        }
        const sortedRequests = [...homeostatTransductionRequestByEncodedRequest]
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([, homeostatTransductionRequest]) => homeostatTransductionRequest);
        const encodedRequestChunks: string[] = [];
        let chunkStart = 0;
        while (chunkStart < sortedRequests.length) {
            const encodedChunkOf = (chunkLength: number) => this.homeostatTransductionCodec.encodeRequests(sortedRequests.slice(chunkStart, chunkStart + chunkLength));
            const fits = (chunkLength: number) => encodedChunkOf(chunkLength).length <= maxEncodedRequestsLength;
            let fittingLength = 1;
            let overLength = 2;
            while (chunkStart + fittingLength < sortedRequests.length && fits(Math.min(overLength, sortedRequests.length - chunkStart))) {
                fittingLength = Math.min(overLength, sortedRequests.length - chunkStart);
                overLength *= 2;
            }
            overLength = Math.min(overLength, sortedRequests.length - chunkStart + 1);
            while (overLength - fittingLength > 1) {
                const middleLength = Math.floor((fittingLength + overLength) / 2);
                if (fits(middleLength)) fittingLength = middleLength;
                else overLength = middleLength;
            }
            encodedRequestChunks.push(encodedChunkOf(fittingLength));
            chunkStart += fittingLength;
        }
        return encodedRequestChunks;
    }
}
