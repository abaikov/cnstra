import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import { CNS_JOB_NAME } from './enqueue';
import type { ICNSBullJob, ICNSBullQueueLike, TCNSStimulationJobData } from './types';

/** The two calls this needs beyond `add` — kept structural, like the rest. */
export interface ICNSBullActionQueueLike extends ICNSBullQueueLike {
    getJob(jobId: string): Promise<ICNSBullActionJob | undefined | null>;
}

export interface ICNSBullActionJob extends ICNSBullJob {
    getState(): Promise<string>;
    retry(state?: string): Promise<void>;
}

/**
 * Carries out DevTools actions against a BullMQ queue.
 *
 * **Retry is the broker's own retry**, not a re-`add`: `job.retry()` moves a
 * finished job back to wait under the SAME job id, keeping its history and
 * letting BullMQ increment `attemptsMade`. Re-adding it instead would hit
 * BullMQ's job-id deduplication and silently do nothing — and since a job id is
 * our `stimulationId`, changing the id to dodge that would sever the run from
 * its own business key.
 *
 * The frontier needs no shipping: the job id is unchanged, and the worker loads
 * the resume checkpoint keyed by it.
 *
 * Ownership is decided by asking the queue whether it holds the job. A run that
 * came from somewhere else — another queue, an HTTP handler, a cron — is passed
 * to the next link untouched.
 */
export const createCNSBullActions = (
    queue: ICNSBullActionQueueLike
): TCNSDevToolsActionMiddleware => {
    return async (action, next) => {
        if (action.type === 'command') return next();
        if (action.type === 'launch') {
            // A clone or a replay: a NEW run, so a new job under the new id.
            const data: TCNSStimulationJobData = {
                collateralName: action.entry.collateralName,
                payload: action.entry.payload,
                ...(action.options?.maxHops
                    ? { maxNeuronHops: action.options.maxHops }
                    : {}),
            };
            await queue.add(CNS_JOB_NAME, data, {
                jobId: action.stimulationId,
            });
            return;
        }

        const job = await queue.getJob(action.stimulationId);
        // Not ours: another queue, or a run that never came from a broker.
        if (!job) return next();

        const state = await job.getState();
        if (state === 'failed' || state === 'completed') {
            await job.retry(state);
            return;
        }

        // Already waiting, delayed or running: the work is going to happen, and
        // a second push would only duplicate it. Claim the action so no later
        // link re-runs the same job.
    };
};
