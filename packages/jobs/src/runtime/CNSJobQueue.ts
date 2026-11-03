import { CNSJobEventEmitter } from '../events/CNSJobEventEmitter';
import { CNSJobEnqueueEvents } from '../events/CNSJobEnqueueEvents';
import { CNSJobTransitionEvents } from '../events/CNSJobTransitionEvents';
import type { ICNSJobRepository } from '../interfaces/ICNSJobRepository';
import { CNSJobEnqueueRequestBuilder } from '../job/CNSJobEnqueueRequestBuilder';
import { CNSJobMiddlewareChain } from '../middleware/CNSJobMiddlewareChain';
import type { ECNSJobCancelAs } from '../types/ECNSJobCancelAs';
import type { ECNSJobEventName } from '../types/ECNSJobEventName';
import type { TCNSJob } from '../types/TCNSJob';
import type { TCNSJobCancelResult } from '../types/TCNSJobCancelResult';
import type { TCNSJobEnqueueMiddleware } from '../types/TCNSJobEnqueueMiddleware';
import type { TCNSJobEnqueueOptions } from '../types/TCNSJobEnqueueOptions';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobEnqueueResult } from '../types/TCNSJobEnqueueResult';
import type { TCNSJobEventListener } from '../types/TCNSJobEventListener';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';
import type { TCNSJobLogEntry } from '../types/TCNSJobLogEntry';
import type { TCNSJobLogQuery } from '../types/TCNSJobLogQuery';
import type { TCNSJobQueueOptions } from '../types/TCNSJobQueueOptions';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobTypeDefinition } from '../types/TCNSJobTypeDefinition';
import { CNSJobFinishWaiter } from './CNSJobFinishWaiter';

const ENQUEUE_EVENTS: Record<TCNSJobEnqueueResult['status'], ECNSJobEventName> = {
    inserted: 'job.enqueued',
    unchecked: 'job.enqueued',
    replaced: 'job.replaced',
    deduplicated: 'job.deduplicated',
};

export class CNSJobQueue<TTransaction = unknown> {
    readonly events: CNSJobEventEmitter;

    private readonly repository: ICNSJobRepository<TTransaction>;
    private readonly definitions = new Map<string, TCNSJobTypeDefinition>();
    private readonly middlewares: readonly TCNSJobEnqueueMiddleware[];

    constructor(options: TCNSJobQueueOptions<TTransaction>) {
        this.repository = options.repository;
        // eslint-disable-next-line no-console
        this.events = options.events ?? new CNSJobEventEmitter(error => console.error(error));
        for (const definition of options.definitions ?? []) this.definitions.set(definition.jobType, definition);
        this.middlewares = options.middlewares ?? [];
    }

    on(name: ECNSJobEventName | '*', listener: TCNSJobEventListener): () => void {
        return this.events.on(name, listener);
    }

    async enqueue<TPayload>(job: TCNSJob<TPayload>, options?: TCNSJobEnqueueOptions<TTransaction>): Promise<TCNSJobEnqueueResult | undefined> {
        const [result] = await this.enqueueMany([job], options);
        return result;
    }

    async enqueueMany(jobs: readonly TCNSJob[], options?: TCNSJobEnqueueOptions<TTransaction>): Promise<Array<TCNSJobEnqueueResult | undefined>> {
        const admitted: Array<TCNSJobEnqueueRequest | undefined> = [];
        for (const job of jobs) admitted.push(await this.admitOne(CNSJobEnqueueRequestBuilder.build(job, this.definitions.get(job.jobType))));

        const accepted = admitted.filter((request): request is TCNSJobEnqueueRequest => request !== undefined);
        const results = accepted.length === 0 ? [] : await this.repository.enqueue(accepted, options);
        if (options?.transaction === undefined) {
            accepted.forEach((request, index) => this.emitEnqueued(request, results[index]));
        }

        let next = 0;
        return admitted.map(request => (request === undefined ? undefined : results[next++]));
    }

    async cancel(jobIds: readonly string[], as: ECNSJobCancelAs = 'cancelled'): Promise<TCNSJobCancelResult> {
        const result = await this.repository.cancel(jobIds, as);
        CNSJobTransitionEvents.emitFinished(this.events, result.transitions ?? []);
        for (const jobId of result.cancelled) {
            this.events.emit({ name: as === 'superseded' ? 'job.superseded' : 'job.cancelled', jobId });
        }
        return result;
    }

    async retry(jobIds: readonly string[]): Promise<string[]> {
        const retried = await this.repository.retry(jobIds);
        for (const jobId of retried) this.events.emit({ name: 'job.retried', jobId });
        return retried;
    }

    runNow(jobIds: readonly string[]): Promise<string[]> {
        return this.repository.runNow(jobIds);
    }

    prioritize(jobIds: readonly string[], priority: number): Promise<string[]> {
        return this.repository.prioritize(jobIds, priority);
    }

    async remove(jobIds: readonly string[]): Promise<string[]> {
        const removed = await this.repository.remove(jobIds);
        for (const jobId of removed) this.events.emit({ name: 'job.removed', jobId });
        return removed;
    }

    get(jobId: string): Promise<TCNSJobState | TCNSJobHistoryState | undefined> {
        return this.repository.get(jobId);
    }

    waitFor(jobId: string, signal?: AbortSignal): Promise<TCNSJobHistoryState> {
        return new CNSJobFinishWaiter(this.repository, jobId, signal).wait();
    }

    async logs(jobId: string, query?: TCNSJobLogQuery): Promise<TCNSJobLogEntry[]> {
        return this.repository.logRepository.list(jobId, query);
    }

    private async admitOne(request: TCNSJobEnqueueRequest): Promise<TCNSJobEnqueueRequest | undefined> {
        let admitted: TCNSJobEnqueueRequest | undefined;
        await CNSJobMiddlewareChain.compose<TCNSJobEnqueueRequest, void>(this.middlewares, async reached => {
            admitted = reached;
        })(request);
        return admitted;
    }

    private emitEnqueued(request: TCNSJobEnqueueRequest, result: TCNSJobEnqueueResult | undefined): void {
        if (!result) return;
        const { jobType, jobGroup } = request.job;
        CNSJobEnqueueEvents.emitLeft(this.events, request.job, result);
        this.events.emit({ name: ENQUEUE_EVENTS[result.status], jobId: result.jobId, jobType, jobGroup });
    }
}
