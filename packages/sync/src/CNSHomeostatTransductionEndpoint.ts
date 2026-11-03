import type { ICNSHomeostatTransductionCodec } from './interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionEndpointOptions } from './types/TCNSHomeostatTransductionEndpointOptions';
import type { TCNSHomeostatTransductionRequest } from './types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionResponse } from './types/TCNSHomeostatTransductionResponse';
import { CNSHomeostatTransductionQueryCodec } from './CNSHomeostatTransductionQueryCodec';

export class CNSHomeostatTransductionEndpoint {
    private readonly batchTransduceFn: TCNSHomeostatTransductionEndpointOptions['batchTransduceFn'];

    private readonly homeostatTransductionCodecs: readonly ICNSHomeostatTransductionCodec[];

    private readonly maxBatchSize: number;

    public constructor(options: TCNSHomeostatTransductionEndpointOptions) {
        this.batchTransduceFn = options.batchTransduceFn;
        this.homeostatTransductionCodecs = options.homeostatTransductionCodecs ?? [CNSHomeostatTransductionQueryCodec.INSTANCE];
        this.maxBatchSize = options.maxBatchSize ?? Infinity;
    }

    public async respond(encodedRequests: string, accept: string | undefined): Promise<TCNSHomeostatTransductionResponse> {
        const homeostatTransductionCodec = this.homeostatTransductionCodecOf(accept);
        if (homeostatTransductionCodec === undefined) {
            return {
                status: 406,
                headers: { 'content-type': 'text/plain', vary: 'accept' },
                body: `accept one of: ${this.homeostatTransductionCodecs.map(codec => codec.mediaType).join(', ')}`,
            };
        }
        let homeostatTransductionRequests: TCNSHomeostatTransductionRequest[];
        try {
            homeostatTransductionRequests = homeostatTransductionCodec.decodeRequests(encodedRequests);
        } catch (error) {
            return { status: 400, headers: { 'content-type': 'text/plain', vary: 'accept' }, body: error instanceof Error ? error.message : String(error) };
        }
        if (homeostatTransductionRequests.length > this.maxBatchSize) {
            return { status: 413, headers: { 'content-type': 'text/plain', vary: 'accept' }, body: `${homeostatTransductionRequests.length} keys, at most ${this.maxBatchSize}` };
        }
        const homeostatTransductionRows = await this.batchTransduceFn(homeostatTransductionRequests);
        return {
            status: 200,
            headers: { 'content-type': homeostatTransductionCodec.mediaType, vary: 'accept' },
            body: homeostatTransductionCodec.encodeRows(homeostatTransductionRows, encodedRequests),
        };
    }

    private homeostatTransductionCodecOf(accept: string | undefined): ICNSHomeostatTransductionCodec | undefined {
        const mediaRanges = (accept ?? '').split(',').map(mediaRange => mediaRange.split(';').map(part => part.trim())).filter(([mediaType]) => mediaType !== '');
        if (mediaRanges.length === 0) return this.homeostatTransductionCodecs[0];
        const qualifiedMediaRanges = mediaRanges.flatMap(([mediaType = '', ...parameters]) => {
            const quality = parameters.find(parameter => /^q\s*=/i.test(parameter))?.replace(/^q\s*=\s*/i, '') ?? '1';
            return /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(quality) ? [{ mediaType: mediaType.toLowerCase(), quality: Number(quality) }] : [];
        });
        let acceptedCodec: ICNSHomeostatTransductionCodec | undefined;
        let acceptedQuality = 0;
        for (const homeostatTransductionCodec of this.homeostatTransductionCodecs) {
            const mediaType = homeostatTransductionCodec.mediaType.toLowerCase();
            const quality = [mediaType, `${mediaType.split('/')[0]}/*`, '*/*']
                .map(matchingMediaType => qualifiedMediaRanges.find(mediaRange => mediaRange.mediaType === matchingMediaType))
                .find(mediaRange => mediaRange !== undefined)?.quality ?? 0;
            if (quality > acceptedQuality) {
                acceptedCodec = homeostatTransductionCodec;
                acceptedQuality = quality;
            }
        }
        return acceptedCodec;
    }
}
