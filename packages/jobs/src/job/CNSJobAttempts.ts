import type { TCNSJobAttempt } from '../types/TCNSJobAttempt';
import type { TCNSJobBudget } from '../types/TCNSJobBudget';

export class CNSJobAttempts {
    static readonly KEEP = 50;

    static last(attempts: readonly TCNSJobAttempt[]): TCNSJobAttempt | undefined {
        return attempts[attempts.length - 1];
    }

    static open(attempts: readonly TCNSJobAttempt[], attemptNumber: number): TCNSJobAttempt | undefined {
        const last = CNSJobAttempts.last(attempts);
        return last && last.attemptNumber === attemptNumber && last.completedAt === undefined ? last : undefined;
    }

    static nextNumber(attempts: readonly TCNSJobAttempt[]): number {
        return (CNSJobAttempts.last(attempts)?.attemptNumber ?? 0) + 1;
    }

    static budget(attempts: readonly TCNSJobAttempt[]): TCNSJobBudget {
        const markerIndex = CNSJobAttempts.lastRetriedIndex(attempts);
        let failed = 0;
        let stale = 0;
        for (let index = markerIndex + 1; index < attempts.length; index++) {
            if (attempts[index].status === 'failed') failed++;
            else if (attempts[index].status === 'stale') stale++;
        }
        const last = CNSJobAttempts.last(attempts);
        const marker = markerIndex >= 0 ? attempts[markerIndex] : undefined;
        const started = last ? last.attemptNumber - (marker?.attemptNumber ?? 0) : 0;
        return { failed, stale, started };
    }

    static trim(attempts: readonly TCNSJobAttempt[], keep: number = CNSJobAttempts.KEEP): TCNSJobAttempt[] {
        if (attempts.length <= keep) return [...attempts];
        const markerIndex = CNSJobAttempts.lastRetriedIndex(attempts);
        const kept = new Set<number>([attempts.length - 1]);
        if (markerIndex >= 0) kept.add(markerIndex);
        attempts.forEach((attempt, index) => {
            if (index > markerIndex && (attempt.status === 'failed' || attempt.status === 'stale')) kept.add(index);
        });
        for (let index = attempts.length - 1; index >= 0 && kept.size < keep; index--) kept.add(index);
        return attempts.filter((_, index) => kept.has(index));
    }

    private static lastRetriedIndex(attempts: readonly TCNSJobAttempt[]): number {
        for (let index = attempts.length - 1; index >= 0; index--) {
            if (attempts[index].status === 'retried') return index;
        }
        return -1;
    }
}
