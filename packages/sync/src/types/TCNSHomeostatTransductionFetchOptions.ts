import type { ICNSHomeostatTransductionCodec } from '../interfaces/ICNSHomeostatTransductionCodec';

export type TCNSHomeostatTransductionFetchOptions = {
    url: string;
    homeostatTransductionCodec?: ICNSHomeostatTransductionCodec | undefined;
    fetch?: typeof globalThis.fetch | undefined;
    headers?: Record<string, string> | undefined;
    maxUrlLength?: number | undefined;
    timeoutMs?: number | undefined;
};
