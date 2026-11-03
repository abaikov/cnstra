import type { ICNSHomeostatTransductionCodec } from './interfaces/ICNSHomeostatTransductionCodec';
import type { TCNSHomeostatTransductionCover } from './types/TCNSHomeostatTransductionCover';
import type { TCNSHomeostatTransductionQueryCodecOptions } from './types/TCNSHomeostatTransductionQueryCodecOptions';
import type { TCNSHomeostatTransductionRequest } from './types/TCNSHomeostatTransductionRequest';
import type { TCNSHomeostatTransductionRow } from './types/TCNSHomeostatTransductionRow';
import { cnsFingerprintOf } from './utils/cnsFingerprintOf';
import { hashCNSHomeostatTransductionRequest } from './utils/hashCNSHomeostatTransductionRequest';

export class CNSHomeostatTransductionQueryCodec implements ICNSHomeostatTransductionCodec {
    public static readonly INSTANCE = new CNSHomeostatTransductionQueryCodec();

    public readonly mediaType: string;

    private readonly homeostatTransductionCovers: readonly TCNSHomeostatTransductionCover[];

    public constructor(options?: TCNSHomeostatTransductionQueryCodecOptions) {
        this.homeostatTransductionCovers = options?.homeostatTransductionCovers ?? [];
        this.refuseCoverCycles();
        const coveredNames = this.homeostatTransductionCovers
            .map(cover => `${cover.coveringName}>${cover.coveredName}${cover.revision === undefined ? '' : `@${cover.revision}`}`)
            .sort()
            .join(',');
        this.mediaType = coveredNames === ''
            ? 'application/vnd.cnstra.transduction-query.v1+json'
            : `application/vnd.cnstra.transduction-query.v1.covers-${cnsFingerprintOf(coveredNames)}+json`;
    }

    public dropCoveredRequests(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): TCNSHomeostatTransductionRequest[] {
        const requests = this.withoutRepeats(homeostatTransductionRequests);
        if (this.homeostatTransductionCovers.length === 0) return requests;
        const coveredRequestHashes = new Set<string>();
        for (const request of requests) for (const coveredRequestHash of this.coveredRequestHashesOf(request)) coveredRequestHashes.add(coveredRequestHash);
        return requests.filter(({ name, key }) => !coveredRequestHashes.has(hashCNSHomeostatTransductionRequest(name, key)));
    }

    public encodeRequests(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): string {
        const encodedKeysByName = new Map<string, Set<string>>();
        for (const { name, key } of this.dropCoveredRequests(homeostatTransductionRequests)) {
            let encodedKeys = encodedKeysByName.get(name);
            if (encodedKeys === undefined) {
                encodedKeys = new Set();
                encodedKeysByName.set(name, encodedKeys);
            }
            encodedKeys.add(key.map(keyPart => this.encodeKeyPart(keyPart)).join(','));
        }
        return [...encodedKeysByName.keys()].sort().map(name => {
            const encodedKeys = [...(encodedKeysByName.get(name) ?? [])].sort();
            return `${encodeURIComponent(name)}=${encodedKeys.join(';')}`;
        }).join('&');
    }

    public decodeRequests(encodedRequests: string): TCNSHomeostatTransductionRequest[] {
        const homeostatTransductionRequests: TCNSHomeostatTransductionRequest[] = [];
        if (encodedRequests === '') return homeostatTransductionRequests;
        for (const encodedGroup of encodedRequests.split('&')) {
            const equalsAt = encodedGroup.indexOf('=');
            if (equalsAt < 0) throw new Error(`homeostat transduction requests: no '=' in '${encodedGroup}'`);
            const name = decodeURIComponent(encodedGroup.slice(0, equalsAt));
            for (const encodedKey of encodedGroup.slice(equalsAt + 1).split(';')) {
                homeostatTransductionRequests.push({ name, key: encodedKey === '' ? [] : encodedKey.split(',').map(encodedKeyPart => this.decodeKeyPart(encodedKeyPart)) });
            }
        }
        return this.withCoveredRequests(homeostatTransductionRequests);
    }

    public encodeRows(homeostatTransductionRows: readonly TCNSHomeostatTransductionRow[], encodedRequests: string): string {
        const requestIndexByRequestHash = new Map<string, number>();
        this.decodeRequests(encodedRequests).forEach(({ name, key }, requestIndex) => {
            requestIndexByRequestHash.set(hashCNSHomeostatTransductionRequest(name, key), requestIndex);
        });
        return JSON.stringify(homeostatTransductionRows.flatMap(homeostatTransductionRow => {
            const requestIndex = requestIndexByRequestHash.get(hashCNSHomeostatTransductionRequest(homeostatTransductionRow.name, homeostatTransductionRow.key));
            if (requestIndex === undefined) return [];
            if ('error' in homeostatTransductionRow) {
                const error = homeostatTransductionRow.error;
                return [[requestIndex, null, error instanceof Error ? { ...error, name: error.name, message: error.message } : error]];
            }
            return ['data' in homeostatTransductionRow ? [requestIndex, homeostatTransductionRow.data] : [requestIndex]];
        }));
    }

    public decodeRows(encodedRows: string, encodedRequests: string): TCNSHomeostatTransductionRow[] {
        const homeostatTransductionRequests = this.decodeRequests(encodedRequests);
        const encodedTuples: unknown = JSON.parse(encodedRows);
        if (!Array.isArray(encodedTuples)) throw new Error('homeostat transduction rows: not an array');
        return encodedTuples.map((encodedTuple: unknown, index) => {
            if (!Array.isArray(encodedTuple) || encodedTuple.length < 1 || encodedTuple.length > 3) {
                throw new Error(`homeostat transduction row ${index}: not [request], [request, data] or [request, null, error]`);
            }
            const requestIndex: unknown = encodedTuple[0];
            const homeostatTransductionRequest = typeof requestIndex === 'number' ? homeostatTransductionRequests[requestIndex] : undefined;
            if (homeostatTransductionRequest === undefined) throw new Error(`homeostat transduction row ${index}: no request ${String(requestIndex)}`);
            const { name, key } = homeostatTransductionRequest;
            if (encodedTuple.length === 1) return { name, key };
            return encodedTuple.length === 3 ? { name, key, error: encodedTuple[2] } : { name, key, data: encodedTuple[1] };
        });
    }

    private refuseCoverCycles(): void {
        const coveredNamesByName = new Map<string, string[]>();
        for (const { coveringName, coveredName } of this.homeostatTransductionCovers) {
            coveredNamesByName.set(coveringName, [...(coveredNamesByName.get(coveringName) ?? []), coveredName]);
        }
        for (const startName of coveredNamesByName.keys()) {
            const reachedNames = new Set<string>();
            const pendingNames = [...(coveredNamesByName.get(startName) ?? [])];
            for (const pendingName of pendingNames) {
                if (pendingName === startName) throw new Error(`homeostat transduction covers: ${startName} covers itself through a cycle`);
                if (reachedNames.has(pendingName)) continue;
                reachedNames.add(pendingName);
                pendingNames.push(...(coveredNamesByName.get(pendingName) ?? []));
            }
        }
    }

    private withoutRepeats(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): TCNSHomeostatTransductionRequest[] {
        const requestHashes = new Set<string>();
        return homeostatTransductionRequests.filter(({ name, key }) => {
            const requestHash = hashCNSHomeostatTransductionRequest(name, key);
            if (requestHashes.has(requestHash)) return false;
            requestHashes.add(requestHash);
            return true;
        });
    }

    private withCoveredRequests(homeostatTransductionRequests: readonly TCNSHomeostatTransductionRequest[]): TCNSHomeostatTransductionRequest[] {
        const expandedRequests = this.withoutRepeats(homeostatTransductionRequests);
        const requestHashes = new Set(expandedRequests.map(({ name, key }) => hashCNSHomeostatTransductionRequest(name, key)));
        for (const coveringRequest of expandedRequests) {
            for (const coveredRequest of this.coveredRequestsOf(coveringRequest)) {
                const coveredRequestHash = hashCNSHomeostatTransductionRequest(coveredRequest.name, coveredRequest.key);
                if (requestHashes.has(coveredRequestHash)) continue;
                requestHashes.add(coveredRequestHash);
                expandedRequests.push(coveredRequest);
            }
        }
        return expandedRequests;
    }

    private coveredRequestsOf(coveringRequest: TCNSHomeostatTransductionRequest): TCNSHomeostatTransductionRequest[] {
        return this.homeostatTransductionCovers
            .filter(homeostatTransductionCover => homeostatTransductionCover.coveringName === coveringRequest.name)
            .map(homeostatTransductionCover => ({ name: homeostatTransductionCover.coveredName, key: homeostatTransductionCover.selectCoveredKey(coveringRequest.key) }));
    }

    private coveredRequestHashesOf(coveringRequest: TCNSHomeostatTransductionRequest): Set<string> {
        const coveredRequestHashes = new Set<string>();
        const pendingRequests = [coveringRequest];
        for (const pendingRequest of pendingRequests) {
            for (const coveredRequest of this.coveredRequestsOf(pendingRequest)) {
                const coveredRequestHash = hashCNSHomeostatTransductionRequest(coveredRequest.name, coveredRequest.key);
                if (coveredRequestHashes.has(coveredRequestHash)) continue;
                coveredRequestHashes.add(coveredRequestHash);
                pendingRequests.push(coveredRequest);
            }
        }
        return coveredRequestHashes;
    }

    private encodeKeyPart(keyPart: unknown): string {
        if (keyPart === undefined) return '~';
        if (keyPart === null) return '~n';
        if (keyPart === true) return '~t';
        if (keyPart === false) return '~f';
        if (typeof keyPart === 'number') return `~${encodeURIComponent(String(keyPart))}`;
        if (typeof keyPart !== 'string') throw new Error(`homeostat transduction requests: a key part is ${typeof keyPart}, not a string, number, boolean, null or undefined`);
        if (keyPart === '') return '~e';
        const encodedKeyPart = encodeURIComponent(keyPart);
        return encodedKeyPart.startsWith('~') ? `~${encodedKeyPart}` : encodedKeyPart;
    }

    private decodeKeyPart(encodedKeyPart: string): unknown {
        if (!encodedKeyPart.startsWith('~')) return decodeURIComponent(encodedKeyPart);
        if (encodedKeyPart === '~') return undefined;
        if (encodedKeyPart === '~n') return null;
        if (encodedKeyPart === '~t') return true;
        if (encodedKeyPart === '~f') return false;
        if (encodedKeyPart === '~e') return '';
        if (encodedKeyPart.startsWith('~~')) return decodeURIComponent(encodedKeyPart.slice(1));
        const writtenNumber = decodeURIComponent(encodedKeyPart.slice(1));
        const keyPart = Number(writtenNumber);
        if (String(keyPart) !== writtenNumber) throw new Error(`homeostat transduction requests: '${encodedKeyPart}' is not a key part`);
        return keyPart;
    }
}
