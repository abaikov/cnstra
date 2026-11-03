import { CNSInMemoryStimulationRepository } from '../cnstra';
import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '../cnstra';

/**
 * Seeds an in-memory stimulation repository with a fixed, reproducible history.
 *
 * The devtools panel refreshes its runs list on a timer, and every refresh runs
 * `loadCNSRosterEntries` over whatever the store holds. That is the read this
 * fixture exists to feed. The store is written directly rather than by running
 * the engine, so the roster benchmark measures the derivation and nothing else —
 * seeding through real stimulations would fold the engine's cost into a number
 * that is supposed to be about a query.
 *
 * Everything is a function of the run's index: statuses, entry collaterals,
 * neuron names and timestamps all cycle deterministically, so two runs of the
 * benchmark see byte-identical stores.
 */
export class CNSBenchRosterFactory {
    /** Fixed origin for the synthetic timeline; keeps `startedAt` off the wall clock. */
    private static readonly epochMs = 1_700_000_000_000;

    private static readonly statuses = ['completed', 'failed', 'running'];
    private static readonly entryCollaterals = [
        'importUser',
        'chargeCard',
        'sendEmail',
        'reindexDocument',
    ];
    private static readonly neuronNames = [
        'validate',
        'enrich',
        'persist',
        'notify',
        'audit',
    ];

    /** Tasks recorded per run — the shape a `volume: 'full'` recording leaves behind. */
    static readonly tasksPerRun = 3;

    /**
     * Build a store holding `runCount` completed-ish runs, one attempt each.
     *
     * Unbounded on purpose: the point is to see the derivation's cost at a known
     * size, and an eviction policy would quietly change that size mid-benchmark.
     */
    static async seed(
        runCount: number,
        scopeName = 'bench'
    ): Promise<CNSInMemoryStimulationRepository> {
        const repository = new CNSInMemoryStimulationRepository();
        for (let index = 0; index < runCount; index++) {
            await CNSBenchRosterFactory.seedOne(repository, index, scopeName);
        }
        return repository;
    }

    private static async seedOne(
        repository: CNSInMemoryStimulationRepository,
        index: number,
        scopeName: string
    ): Promise<void> {
        // Zero-padded so lexicographic order matches numeric order — the roster
        // sorts on `(startedAt DESC, stimulationId DESC)` and a ragged id would
        // make the tie-break depend on digit count.
        const stimulationId = `bench-stim-${String(index).padStart(6, '0')}`;
        const stimulationAttemptId = `${stimulationId}#1`;
        const status =
            CNSBenchRosterFactory.statuses[
                index % CNSBenchRosterFactory.statuses.length
            ]!;
        const collateralName =
            CNSBenchRosterFactory.entryCollaterals[
                index % CNSBenchRosterFactory.entryCollaterals.length
            ]!;
        const startedAt = CNSBenchRosterFactory.epochMs + index * 1_000;

        const entry = {
            collateralName,
            payload: { id: index, amount: (index % 97) + 1 },
        };

        const stimulation: TCNSStimulationState = {
            stimulationId,
            entry,
            status: status as TCNSStimulationState['status'],
            progress: { tasks: [] },
            scopeName,
        };
        await repository.saveStimulation(stimulation);

        const attempt: TCNSStimulationAttempt = {
            stimulationAttemptId,
            stimulationId,
            attemptNumber: 1,
            status: status as TCNSStimulationAttempt['status'],
            startedAt,
            completedAt: status === 'running' ? null : startedAt + 250,
            hopCount: CNSBenchRosterFactory.tasksPerRun,
            hasError: status === 'failed',
            replayOf: null,
            entry: [entry],
        };
        await repository.saveAttempt(attempt);

        for (let slot = 0; slot < CNSBenchRosterFactory.tasksPerRun; slot++) {
            const neuronName =
                CNSBenchRosterFactory.neuronNames[
                    (index + slot) % CNSBenchRosterFactory.neuronNames.length
                ]!;
            const task: TCNSStimulationTask = {
                stimulationAttemptId,
                index: slot + 1,
                neuronName,
                dendriteCollateralName: collateralName,
                inputIndex: 0,
                output: {
                    collateralName: `${neuronName}Done`,
                    payload: { id: index, slot },
                },
                status: status === 'failed' && slot === 2 ? 'failed' : 'done',
                error:
                    status === 'failed' && slot === 2
                        ? 'bench: recorded failure'
                        : null,
                startedAt: startedAt + slot,
                duration: 1,
            };
            await repository.appendTask(task);
        }
    }
}
