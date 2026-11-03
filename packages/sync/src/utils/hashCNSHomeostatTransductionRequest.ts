import { hashCNSHomeostatKey } from './hashCNSHomeostatKey';

export function hashCNSHomeostatTransductionRequest(name: string, key: readonly unknown[]): string {
    return JSON.stringify([name, hashCNSHomeostatKey(key)]);
}
