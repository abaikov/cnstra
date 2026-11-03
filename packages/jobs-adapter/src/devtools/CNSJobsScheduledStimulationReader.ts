import type { ICNSJobRepository, TCNSJobListCursor, TCNSJobState, TCNSJobTypeDefinition } from '@cnstra/jobs';
import type { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type {
    ICNSScheduledStimulationReader,
    TCNSPlannedTaskJSON,
    TCNSProgress,
    TCNSScheduledStimulationFilter,
    TCNSScheduledStimulationPage,
    TCNSScheduledStimulationState,
    TCNSScheduledStimulationTypeState,
    TCNSStimulationScheduleState,
} from '@cnstra/persist-dto';

export class CNSJobsScheduledStimulationReader implements ICNSScheduledStimulationReader {
    private static readonly SCANNED_PAGES = 20;

    constructor(
        private readonly repository: ICNSJobRepository<unknown>,
        private readonly registry: CNSPersistOptionsRegistry,
        private readonly definitions: () => readonly TCNSJobTypeDefinition[]
    ) {}

    async list(filter: TCNSScheduledStimulationFilter, cursor: string | null, limit: number): Promise<TCNSScheduledStimulationPage> {
        const definitions = this.definitions();
        const jobTypes = definitions.map(definition => definition.jobType);
        const listeners = this.listenersByCollateral();
        const rows: TCNSScheduledStimulationState[] = [];
        let after = CNSJobsScheduledStimulationReader.decode(cursor);
        let more = true;
        for (let page = 0; page < CNSJobsScheduledStimulationReader.SCANNED_PAGES && more && rows.length < limit; page++) {
            const jobs = await this.repository.list({ jobTypes, running: false, after, limit });
            more = jobs.length === limit;
            for (const [index, jobState] of jobs.entries()) {
                after = { runAfter: jobState.runAfter, seq: jobState.seq };
                const row = this.rowOf(jobState, listeners);
                if (this.matches(row, filter)) rows.push(row);
                if (rows.length === limit) {
                    more ||= index < jobs.length - 1;
                    break;
                }
            }
        }
        return {
            rows,
            schedules: cursor === null ? await this.schedulesOf(jobTypes, filter, listeners) : [],
            types: cursor === null ? this.typesOf(definitions, filter, listeners) : [],
            nextCursor: more && after ? `${after.runAfter}:${after.seq}` : null,
        };
    }

    private rowOf(jobState: TCNSJobState, listeners: ReadonlyMap<string, string[]>): TCNSScheduledStimulationState {
        const frontier = this.frontierOf(jobState);
        const row: TCNSScheduledStimulationState = {
            stimulationId: jobState.jobId,
            entry: { collateralName: jobState.jobType, payload: jobState.payload },
            status: jobState.wait ?? 'ready',
            runAfter: jobState.runAfter,
            priority: jobState.priority,
            attemptCount: jobState.attempts.filter(attempt => attempt.status !== 'retried' && attempt.status !== 'snoozed').length,
            resumes: frontier !== undefined,
            tasks: frontier ?? (listeners.get(jobState.jobType) ?? []).map(neuronName => ({ neuronName, dendriteCollateralName: jobState.jobType })),
        };
        if (jobState.jobKey !== undefined) row.jobKey = jobState.jobKey;
        if (jobState.jobGroup !== undefined) row.jobGroup = jobState.jobGroup;
        return row;
    }

    private frontierOf(jobState: TCNSJobState): TCNSPlannedTaskJSON[] | undefined {
        const progress = jobState.state as TCNSProgress | undefined;
        if (!Array.isArray(progress?.tasks) || progress.tasks.length === 0) return undefined;
        return progress.tasks.map(task => ({ neuronName: task.neuronName, dendriteCollateralName: task.dendriteCollateralName }));
    }

    private listenersByCollateral(): Map<string, string[]> {
        const listeners = new Map<string, string[]>();
        for (const [neuronName, neuron] of this.registry.getNamedNeurons()) {
            for (const dendrite of neuron.dendrites) {
                const collateralName = this.registry.getCollateralName(dendrite.collateral);
                if (collateralName === undefined) continue;
                const names = listeners.get(collateralName) ?? [];
                if (!names.includes(neuronName)) names.push(neuronName);
                listeners.set(collateralName, names);
            }
        }
        return listeners;
    }

    private matches(row: TCNSScheduledStimulationState, filter: TCNSScheduledStimulationFilter): boolean {
        const { collateralName, neuronName } = filter;
        if (collateralName !== undefined && row.entry.collateralName !== collateralName && !row.tasks.some(task => task.dendriteCollateralName === collateralName)) {
            return false;
        }
        return neuronName === undefined || row.tasks.some(task => task.neuronName === neuronName);
    }

    private async schedulesOf(
        jobTypes: readonly string[],
        filter: TCNSScheduledStimulationFilter,
        listeners: ReadonlyMap<string, string[]>
    ): Promise<TCNSStimulationScheduleState[]> {
        const schedules = await this.repository.listSchedules(jobTypes);
        return schedules
            .filter(schedule => this.covers(schedule.jobType, filter, listeners))
            .map(schedule => {
                const state: TCNSStimulationScheduleState = { scheduleId: schedule.scheduleId, collateralName: schedule.jobType };
                if (schedule.cron !== undefined) state.cron = schedule.cron;
                if (schedule.everyMs !== undefined) state.everyMs = schedule.everyMs;
                if (schedule.tz !== undefined) state.tz = schedule.tz;
                return state;
            });
    }

    private typesOf(
        definitions: readonly TCNSJobTypeDefinition[],
        filter: TCNSScheduledStimulationFilter,
        listeners: ReadonlyMap<string, string[]>
    ): TCNSScheduledStimulationTypeState[] {
        return definitions
            .filter(definition => this.covers(definition.jobType, filter, listeners))
            .map(definition => {
                const type: TCNSScheduledStimulationTypeState = { collateralName: definition.jobType };
                if (definition.description !== undefined) type.description = definition.description;
                if (definition.payloadSchema !== undefined) type.payloadSchema = definition.payloadSchema;
                return type;
            });
    }

    private covers(jobType: string, filter: TCNSScheduledStimulationFilter, listeners: ReadonlyMap<string, string[]>): boolean {
        if (filter.collateralName !== undefined && jobType !== filter.collateralName) return false;
        return filter.neuronName === undefined || (listeners.get(jobType) ?? []).includes(filter.neuronName);
    }

    private static decode(cursor: string | null): TCNSJobListCursor | undefined {
        if (cursor === null) return undefined;
        const [runAfter, seq] = cursor.split(':').map(Number);
        return Number.isFinite(runAfter) && Number.isFinite(seq) ? { runAfter, seq } : undefined;
    }
}
