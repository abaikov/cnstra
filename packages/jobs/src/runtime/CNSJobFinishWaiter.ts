import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';

export class CNSJobFinishWaiter {
    private settled = false;
    private checking = false;
    private checkAgain = false;
    private timer?: ReturnType<typeof setInterval>;
    private unsubscribe?: () => Promise<void>;
    private resolve!: (finished: TCNSJobHistoryState) => void;
    private reject!: (error: unknown) => void;

    constructor(
        private readonly repository: ICNSJobRepository<unknown>,
        private readonly jobId: string,
        private readonly signal?: AbortSignal
    ) {}

    wait(): Promise<TCNSJobHistoryState> {
        if (!this.repository.capabilities.history) {
            return Promise.reject(new Error(`[@cnstra/jobs] waiting for job "${this.jobId}" needs a repository that keeps history`));
        }
        const finished = new Promise<TCNSJobHistoryState>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        if (this.signal?.aborted) {
            this.settle(this.signal.reason);
            return finished;
        }
        this.signal?.addEventListener('abort', this.abort, { once: true });
        this.timer = setInterval(() => void this.check(), this.repository.capabilities.pushWakeups ? 5_000 : 1_000);
        this.repository
            .subscribe({ done: jobId => jobId === this.jobId && void this.check() })
            .then(unsubscribe => {
                if (this.settled) void unsubscribe().catch(() => undefined);
                else this.unsubscribe = unsubscribe;
                void this.check();
            })
            .catch(error => this.settle(error));
        return finished;
    }

    private readonly abort = (): void => this.settle(this.signal?.reason);

    private async check(): Promise<void> {
        if (this.checking) {
            this.checkAgain = true;
            return;
        }
        this.checking = true;
        try {
            do {
                this.checkAgain = false;
                const found = await this.repository.get(this.jobId);
                if (found === undefined) return this.settle(new Error(`[@cnstra/jobs] job "${this.jobId}" is not in the repository`));
                if ('finalStatus' in found) return this.settle(undefined, found);
            } while (this.checkAgain && !this.settled);
        } catch (error) {
            this.settle(error);
        } finally {
            this.checking = false;
        }
    }

    private settle(error: unknown, finished?: TCNSJobHistoryState): void {
        if (this.settled) return;
        this.settled = true;
        clearInterval(this.timer);
        this.signal?.removeEventListener('abort', this.abort);
        void this.unsubscribe?.().catch(() => undefined);
        if (finished) this.resolve(finished);
        else this.reject(error);
    }
}
