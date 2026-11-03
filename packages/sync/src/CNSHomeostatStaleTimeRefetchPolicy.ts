import { ECNSHomeostatCorrectionStatus } from './types/ECNSHomeostatCorrectionStatus';
import type { TCNSHomeostatCorrectionState } from './types/TCNSHomeostatCorrectionState';
import type { TCNSHomeostatRefractoryPolicy } from './types/TCNSHomeostatRefractoryPolicy';
import type { ICNSHomeostatRefetchPolicy } from './interfaces/ICNSHomeostatRefetchPolicy';
import type { TCNSHomeostatStaleTimeRefetchPolicyOptions } from './types/TCNSHomeostatStaleTimeRefetchPolicyOptions';
import { cnsFingerprintOf } from './utils/cnsFingerprintOf';
import { computeCNSHomeostatRefractoryDelayMs } from './utils/computeCNSHomeostatRefractoryDelayMs';

export class CNSHomeostatStaleTimeRefetchPolicy implements ICNSHomeostatRefetchPolicy {
    private readonly staleTimeMs: number;

    private readonly homeostatRefractoryPolicy: TCNSHomeostatRefractoryPolicy | undefined;

    public constructor(options: TCNSHomeostatStaleTimeRefetchPolicyOptions) {
        if (!(options.staleTimeMs > 0)) {
            throw new Error(`homeostat refetch policy: staleTimeMs ${options.staleTimeMs} would refetch as fast as the answers come; give a period above 0, or leave it out and call invalidate`);
        }
        this.staleTimeMs = options.staleTimeMs;
        if (options.homeostatRefractoryPolicy !== undefined && !(options.homeostatRefractoryPolicy.initialDelayMs > 0)) {
            throw new Error(`homeostat refetch policy: homeostatRefractoryPolicy.initialDelayMs ${options.homeostatRefractoryPolicy.initialDelayMs} would ask a failing key again as fast as it fails; give a delay above 0`);
        }
        const jitter = options.homeostatRefractoryPolicy?.jitter ?? 0;
        if (!(jitter >= 0 && jitter <= 1)) {
            throw new Error(`homeostat refetch policy: homeostatRefractoryPolicy.jitter ${jitter} is not a share of the delay; give a ratio from 0 to 1`);
        }
        this.homeostatRefractoryPolicy = options.homeostatRefractoryPolicy;
    }

    public refetchAtMs(homeostatCorrectionState: TCNSHomeostatCorrectionState<unknown>): number {
        const restoredAtMs = homeostatCorrectionState.restoredAtMs;
        if (homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Restored && restoredAtMs !== undefined) return restoredAtMs + this.staleTimeMs;
        const failedAtMs = homeostatCorrectionState.failedAtMs;
        if (homeostatCorrectionState.status === ECNSHomeostatCorrectionStatus.Failed && failedAtMs !== undefined && this.homeostatRefractoryPolicy !== undefined) {
            const jitterFraction = parseInt(cnsFingerprintOf(`${homeostatCorrectionState.receptorName}:${homeostatCorrectionState.firingNumber}:${failedAtMs}`), 16) / 0x1_0000_0000;
            return failedAtMs + computeCNSHomeostatRefractoryDelayMs(this.homeostatRefractoryPolicy, homeostatCorrectionState.attempt, jitterFraction);
        }
        return Infinity;
    }
}
