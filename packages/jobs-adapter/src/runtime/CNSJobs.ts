import { runCNSStimulationJob } from '@cnstra/broker';
import { CNSJobEventEmitter, CNSJobQueue, CNSJobWorker } from '@cnstra/jobs';
import type { TCNSJobEnqueueResult, TCNSJobEvent, TCNSJobHistoryState, TCNSJobRunContext, TCNSJobTypeDefinition } from '@cnstra/jobs';
import { CNSProgressSerializer } from '@cnstra/persist';
import { buildCNSAttemptId } from '@cnstra/persist-dto';
import type { ICNSScheduledStimulationReader, TCNSDevToolsActionMiddleware, TCNSStimulationCommand } from '@cnstra/persist-dto';
import type { ICNSCollateral, TCNSContextStore, TCNSHandlerContext, TCNSStimulationResponse } from '@cnstra/types';
import { CNSJobsScheduledStimulationReader } from '../devtools/CNSJobsScheduledStimulationReader';
import type { ICNSJobsEnqueuer } from '../interfaces/ICNSJobsEnqueuer';
import { CNSJobProgressRepository } from '../progress/CNSJobProgressRepository';
import type { TCNSJobsEnqueueOptions } from '../types/TCNSJobsEnqueueOptions';
import type { TCNSJobsFailurePlace } from '../types/TCNSJobsFailurePlace';
import type { TCNSJobsOptions } from '../types/TCNSJobsOptions';
import type { TCNSJobsParentContext } from '../types/TCNSJobsParentContext';
import type { TCNSJobsTypeEntry } from '../types/TCNSJobsTypeEntry';
import type { TCNSJobsTypeOptions } from '../types/TCNSJobsTypeOptions';
import type { TCNSJobsWorkerOptions } from '../types/TCNSJobsWorkerOptions';

export class CNSJobs<TTransaction = unknown> implements ICNSJobsEnqueuer<TTransaction> {
    private static readonly PARENT_KEYS = {
        parentStimulationId: true,
        parentAttemptId: true,
        traceparent: true,
    } satisfies Record<keyof TCNSJobsParentContext, true>;

    readonly events: CNSJobEventEmitter;

    private readonly types = new Map<string, TCNSJobsTypeEntry>();
    private readonly defaultTypes = new Map<string, TCNSJobsTypeEntry>();
    private readonly serializer: CNSProgressSerializer;
    private readonly onError: (error: unknown) => void;
    private queue: CNSJobQueue<TTransaction>;
    private workersCreated = false;

    constructor(private readonly options: TCNSJobsOptions<TTransaction>) {
        this.onError = options.onError ?? (error => console.error('[@cnstra/jobs-adapter]', error));
        this.events = new CNSJobEventEmitter(error => this.onError(error));
        this.serializer = new CNSProgressSerializer(options.registry);
        this.queue = this.createQueue();
        this.events.on('job.completed', event => this.continueAfter(event));
        this.events.on('job.failed', event => this.continueAfter(event));
    }

    type<TPayload>(collateral: ICNSCollateral<TPayload>, options: TCNSJobsTypeOptions<TPayload> = {}): this {
        const jobType = this.nameOf(collateral);
        if (this.workersCreated) throw new Error(`[@cnstra/jobs-adapter] declare job type "${jobType}" before creating a worker`);
        if (this.types.has(jobType)) throw new Error(`[@cnstra/jobs-adapter] job type "${jobType}" is declared twice`);
        if ((options.onCompleted || options.onFailed) && !this.options.repository.capabilities.history) {
            throw new Error(`[@cnstra/jobs-adapter] job type "${jobType}" has a continuation, which needs a repository that keeps history`);
        }
        this.types.set(jobType, this.entryOf(jobType, options as TCNSJobsTypeOptions<unknown>));
        this.queue = this.createQueue();
        return this;
    }

    enqueue<TPayload>(
        collateral: ICNSCollateral<TPayload>,
        payload: TPayload,
        options: TCNSJobsEnqueueOptions<TTransaction> = {}
    ): Promise<TCNSJobEnqueueResult | undefined> {
        const { transaction, ...job } = options;
        return this.queue.enqueue({ ...job, jobType: this.nameOf(collateral), payload }, transaction === undefined ? undefined : { transaction });
    }

    from(context: Pick<TCNSHandlerContext, 'stimulationContext'>): ICNSJobsEnqueuer<TTransaction> {
        const store = context.stimulationContext;
        const parent: TCNSJobsParentContext = {};
        if (typeof store?.stimulationId === 'string') {
            parent.parentStimulationId = store.stimulationId;
            if (typeof store.attemptNumber === 'number') parent.parentAttemptId = buildCNSAttemptId(store.stimulationId, store.attemptNumber);
        }
        if (typeof store?.traceparent === 'string') parent.traceparent = store.traceparent;
        return {
            enqueue: (collateral, payload, options = {}) => this.enqueue(collateral, payload, { ...options, meta: { ...parent, ...options.meta } }),
        };
    }

    waitFor(jobId: string, signal?: AbortSignal): Promise<TCNSJobHistoryState> {
        return this.queue.waitFor(jobId, signal);
    }

    actions(): TCNSDevToolsActionMiddleware {
        return async (action, next) => {
            if (action.type === 'launch') {
                const jobType = action.entry.collateralName;
                if (!this.types.has(jobType) && !this.defaultTypes.has(jobType)) return next();
                const maxHops = action.options?.maxHops;
                await this.queue.enqueue({ jobType, payload: action.entry.payload, jobId: action.stimulationId, ...(maxHops ? { meta: { maxNeuronHops: maxHops } } : {}) });
                return;
            }
            const found = await this.queue.get(action.stimulationId);
            if (!found) return next();
            if (action.type === 'resume') {
                if ('finalStatus' in found) await this.queue.retry([action.stimulationId]);
                return;
            }
            if ('finalStatus' in found) throw new Error(`[@cnstra/jobs-adapter] job "${action.stimulationId}" has already finished`);
            await this.command(action.stimulationId, action.command);
        };
    }

    private async command(jobId: string, command: TCNSStimulationCommand): Promise<void> {
        if (command.name === 'cancel') {
            await this.queue.cancel([jobId]);
            return;
        }
        const changed = command.name === 'runNow' ? await this.queue.runNow([jobId]) : await this.queue.prioritize([jobId], command.priority);
        if (changed.length === 0) throw new Error(`[@cnstra/jobs-adapter] job "${jobId}" is running or not yet checked, ${command.name} does not apply`);
    }

    scheduledStimulationReader(): ICNSScheduledStimulationReader {
        return new CNSJobsScheduledStimulationReader(this.options.repository, this.options.registry, () =>
            [...this.defaultTypes.values(), ...this.types.values()].map(entry => entry.definition)
        );
    }

    worker(options: TCNSJobsWorkerOptions = {}): CNSJobWorker {
        this.workersCreated = true;
        return new CNSJobWorker({
            ...options,
            repository: this.options.repository,
            events: this.events,
            onError: this.onError,
            handlers: [...this.defaultTypes, ...this.types].map(([jobType, entry]) => ({
                definition: entry.definition,
                run: (payload: unknown, context: TCNSJobRunContext) => this.run(jobType, entry.options, payload, context),
            })),
        });
    }

    private async run(jobType: string, options: TCNSJobsTypeOptions<unknown>, payload: unknown, context: TCNSJobRunContext): Promise<void> {
        const abort = new AbortController();
        const forward = () => abort.abort(context.abortSignal.reason);
        if (context.abortSignal.aborted) forward();
        else context.abortSignal.addEventListener('abort', forward, { once: true });
        const place: TCNSJobsFailurePlace = {};
        let neuronError: Error | undefined;
        try {
            await runCNSStimulationJob({
                pkgName: '@cnstra/jobs-adapter',
                cns: this.options.cns,
                registry: this.options.registry,
                jobId: context.jobState.jobId,
                collateralName: jobType,
                payload,
                maxNeuronHops: typeof context.jobState.meta?.maxNeuronHops === 'number' ? context.jobState.meta.maxNeuronHops : options.maxNeuronHops,
                attemptNumber: context.attempt.attemptNumber,
                observe: this.options.observe,
                serializer: this.serializer,
                resumeRepo: new CNSJobProgressRepository(context, this.options.repository.stateRepository, this.onError),
                resumeStrategy: this.options.resumeStrategy,
                abort,
                stimulationContext: this.parentContextOf(context.jobState.meta),
                onResponse: response => {
                    neuronError ??= response.error;
                    this.recordFailure(place, response, context);
                },
            });
        } catch (error) {
            throw neuronError ?? error;
        } finally {
            context.abortSignal.removeEventListener('abort', forward);
        }
    }

    private recordFailure(place: TCNSJobsFailurePlace, response: TCNSStimulationResponse, context: TCNSJobRunContext): void {
        if (!response.error || place.failedNeuron !== undefined) return;
        const failedNeuron = response.neuron ? this.options.registry.getNeuronName(response.neuron) : undefined;
        const failedCollateral = response.inputSignal ? this.options.registry.getCollateralName(response.inputSignal.collateral) : undefined;
        if (failedNeuron !== undefined) {
            place.failedNeuron = failedNeuron;
            context.attemptMeta.set('failedNeuron', failedNeuron);
        }
        if (failedCollateral !== undefined) {
            place.failedCollateral = failedCollateral;
            context.attemptMeta.set('failedCollateral', failedCollateral);
        }
    }

    private continueAfter(event: TCNSJobEvent): void {
        const { jobId, jobType } = event;
        if (jobId === undefined || jobType === undefined) return;
        const options = (this.types.get(jobType) ?? this.defaultTypes.get(jobType))?.options;
        const collateral = event.name === 'job.completed' ? options?.onCompleted : options?.onFailed;
        if (!collateral) return;
        this.continueWith(collateral as ICNSCollateral<unknown>, jobId, event.name === 'job.failed').catch(error => this.onError(error));
    }

    private async continueWith(collateral: ICNSCollateral<unknown>, jobId: string, failed: boolean): Promise<void> {
        const finished = (await this.options.repository.get(jobId)) as TCNSJobHistoryState | undefined;
        if (!finished || !('finalStatus' in finished)) throw new Error(`[@cnstra/jobs-adapter] finished job "${jobId}" is not in history, its continuation is skipped`);
        const value = failed ? { ...this.failurePlaceOf(finished), jobId, payload: finished.payload } : { jobId, payload: finished.payload };
        const stimulation = this.options.cns.stimulate(collateral.createSignal(value), { stimulationContext: { parentStimulationId: jobId } });
        await stimulation.waitUntilComplete();
    }

    private failurePlaceOf(finished: TCNSJobHistoryState): TCNSJobsFailurePlace {
        const last = finished.attempts[finished.attempts.length - 1];
        const place: TCNSJobsFailurePlace = {};
        if (last?.errorName !== undefined) place.errorName = last.errorName;
        if (typeof last?.meta?.failedNeuron === 'string') place.failedNeuron = last.meta.failedNeuron;
        if (typeof last?.meta?.failedCollateral === 'string') place.failedCollateral = last.meta.failedCollateral;
        return place;
    }

    private parentContextOf(meta: TCNSContextStore | undefined): TCNSContextStore {
        const parent: TCNSContextStore = {};
        for (const key of Object.keys(CNSJobs.PARENT_KEYS) as Array<keyof TCNSJobsParentContext>) {
            if (typeof meta?.[key] === 'string') parent[key] = meta[key];
        }
        return parent;
    }

    private nameOf(collateral: ICNSCollateral<unknown>): string {
        const name = this.options.registry.getCollateralName(collateral);
        if (name === undefined) throw new Error('[@cnstra/jobs-adapter] the collateral is not registered in the CNSPersistOptionsRegistry');
        return name;
    }

    private entryOf(jobType: string, options: TCNSJobsTypeOptions<unknown>): TCNSJobsTypeEntry {
        const { maxNeuronHops: _maxNeuronHops, onCompleted: _onCompleted, onFailed: _onFailed, ...definition } = options;
        return { definition: { ...definition, jobType } as TCNSJobTypeDefinition, options };
    }

    private collectDefaultTypes(): void {
        this.defaultTypes.clear();
        const options = this.options.defaultTypeOptions;
        if (!options) return;
        for (const neuron of this.options.registry.getNamedNeurons().values()) {
            for (const dendrite of neuron.dendrites) {
                const jobType = this.options.registry.getCollateralName(dendrite.collateral);
                if (jobType !== undefined && !this.types.has(jobType)) this.defaultTypes.set(jobType, this.entryOf(jobType, options));
            }
        }
    }

    private createQueue(): CNSJobQueue<TTransaction> {
        this.collectDefaultTypes();
        return new CNSJobQueue<TTransaction>({
            repository: this.options.repository,
            definitions: [...this.defaultTypes.values(), ...this.types.values()].map(entry => entry.definition),
            middlewares: this.options.middlewares,
            events: this.events,
        });
    }
}
