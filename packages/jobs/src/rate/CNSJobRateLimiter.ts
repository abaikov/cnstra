import type { TCNSJobRate } from '../types/TCNSJobRate';
import type { TCNSJobStarts } from '../types/TCNSJobStarts';

export class CNSJobRateLimiter {
    private static readonly EPSILON = 1e-6;

    static take(nextStartAt: number | undefined, now: number, rate: TCNSJobRate | undefined, wanted: number): TCNSJobStarts {
        if (nextStartAt !== undefined && nextStartAt > now) return { granted: 0, nextStartAt };
        if (wanted <= 0) return { granted: 0, nextStartAt };
        if (!rate) return { granted: wanted, nextStartAt: undefined };
        if (rate.max <= 0) return { granted: 0, nextStartAt };
        if (rate.durationMs <= 0) return { granted: wanted, nextStartAt: undefined };

        const emissionInterval = rate.durationMs / rate.max;
        const burstTolerance = rate.durationMs - emissionInterval;
        const theoreticalArrival = Math.max((nextStartAt ?? now - burstTolerance) + burstTolerance, now);
        const capacity =
            Math.floor((now + burstTolerance - theoreticalArrival) / emissionInterval + CNSJobRateLimiter.EPSILON) + 1;
        const granted = Math.max(0, Math.min(wanted, capacity));
        if (granted === 0) return { granted, nextStartAt };

        return { granted, nextStartAt: theoreticalArrival + granted * emissionInterval - burstTolerance };
    }
}
