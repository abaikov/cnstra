import type { TCNSHomeostatRefractoryPolicy } from '../types/TCNSHomeostatRefractoryPolicy';

export function computeCNSHomeostatRefractoryDelayMs(homeostatRefractoryPolicy: TCNSHomeostatRefractoryPolicy, attempt: number, jitterFraction: number): number {
    const delayMs = Math.min(
        homeostatRefractoryPolicy.maxDelayMs,
        homeostatRefractoryPolicy.initialDelayMs * homeostatRefractoryPolicy.multiplier ** (attempt - 1),
    );
    return delayMs * (1 - (homeostatRefractoryPolicy.jitter ?? 0) * jitterFraction);
}
