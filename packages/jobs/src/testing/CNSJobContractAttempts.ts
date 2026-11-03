import { CNSJobAttempts } from '../job/CNSJobAttempts';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import type { TCNSJobState } from '../types/TCNSJobState';

export class CNSJobContractAttempts {
    static async open(repository: ICNSJobRepository, jobId: string, asNewJob = false): Promise<{ seq: number; attemptNumber: number }> {
        const previous = (await repository.get(jobId)) as TCNSJobState | undefined;
        const running = previous && CNSJobAttempts.open(previous.attempts, CNSJobAttempts.last(previous.attempts)?.attemptNumber ?? 0);
        if (asNewJob && previous && running) {
            await repository.finish([
                { jobId, seq: previous.seq, attemptNumber: running.attemptNumber, kind: 'final', attemptStatus: 'failed', finalStatus: 'failed' },
            ]);
        }
        if (asNewJob) await repository.remove([jobId]);
        const live = (await repository.get(jobId)) as TCNSJobState | undefined;
        const open = live && CNSJobAttempts.last(live.attempts);
        if (!live) {
            await repository.enqueue([{ job: { jobType: 'state', jobId, payload: null } }]);
        } else if (open) {
            await repository.finish([{ jobId, seq: live.seq, attemptNumber: open.attemptNumber, kind: 'requeue', attemptStatus: 'aborted', runAfter: 0 }]);
        }
        const { claimed } = await repository.claim([{ jobType: 'state', free: 100, leaseMs: 60_000 }], 'contract');
        const opened = claimed.find(jobState => jobState.jobId === jobId);
        if (!opened) throw new Error(`could not open an attempt of ${jobId}`);
        return { seq: opened.seq, attemptNumber: opened.attempts[opened.attempts.length - 1].attemptNumber };
    }
}
