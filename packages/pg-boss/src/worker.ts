import type { CNSPersistOptionsRegistry, ICNS } from '@cnstra/core';
import type {
    IPgBossLike,
    IPgBossJob,
    ICNSProgressSink,
    ICNSResponseLike,
    TCNSHopRecord,
    TCNSStimulationJobData,
} from './types';

export interface TCNSWorkerOptions {
    /** Your pg-boss instance (already started). */
    boss: IPgBossLike;
    /** The CNS the jobs run against. */
    cns: ICNS<any, any>;
    /** Name ↔ object registry used to reconstruct signals from job data. */
    registry: CNSPersistOptionsRegistry;
    /** Queue name to consume. */
    queue: string;
    /** Optional durable progress sink (started / hop / completed). */
    progress?: ICNSProgressSink;
    /** pg-boss `work` options (batchSize, pollingIntervalSeconds, …). */
    workOptions?: Record<string, unknown>;
}

/**
 * Resolve a single response into a durable hop record, turning live object
 * references into stable names via the registry (same derivation devtools uses).
 */
function toHopRecord(
    jobId: string,
    index: number,
    resp: ICNSResponseLike,
    cns: ICNS<any, any>,
    registry: CNSPersistOptionsRegistry
): TCNSHopRecord {
    const outputCol = resp.outputSignal?.collateral;
    const inputCol = resp.inputSignal?.collateral;

    const ownerNeuron = outputCol
        ? cns.network.getParentNeuronByCollateral(outputCol as any)
        : null;

    return {
        jobId,
        index,
        neuronName: ownerNeuron
            ? registry.getNeuronName(ownerNeuron as any) ?? null
            : null,
        inputCollateral: inputCol
            ? registry.getCollateralName(inputCol as any) ?? null
            : null,
        outputCollateral: outputCol
            ? registry.getCollateralName(outputCol as any) ?? null
            : null,
        inputPayload:
            resp.inputSignal?.payload ?? resp.outputSignal?.payload ?? null,
        outputPayload: outputCol ? resp.outputSignal?.payload ?? null : null,
        error: resp.error != null ? String(resp.error) : null,
        at: Date.now(),
    };
}

/**
 * Register a pg-boss worker that turns each job into a CNStra stimulation.
 *
 * One job = one stimulation. The job carries `{ collateralName, payload }`; the
 * worker reconstructs the entry signal by name, stimulates, optionally streams
 * per-hop progress, and awaits completion. If the stimulation fails or aborts,
 * `waitUntilComplete()` rejects and the error propagates so pg-boss applies its
 * own retry/backoff policy.
 */
export function createCNSWorker(options: TCNSWorkerOptions): Promise<string> {
    const { boss, cns, registry, queue, progress, workOptions } = options;

    const runJob = async (
        job: IPgBossJob<TCNSStimulationJobData>
    ): Promise<void> => {
        const { collateralName, payload, maxNeuronHops } = job.data;
        const collateral = registry.getCollateral(collateralName);
        if (!collateral) {
            throw new Error(
                `[@cnstra/pg-boss] Unknown collateral "${collateralName}". ` +
                    `Register it in the CNSPersistOptionsRegistry.`
            );
        }

        const startedAt = Date.now();
        let hopCount = 0;

        await progress?.onStarted?.({
            jobId: job.id,
            collateralName,
            payload,
            status: 'running',
            startedAt,
            hopCount: 0,
        });

        const stimulation = cns.stimulate(collateral.createSignal(payload), {
            maxNeuronHops,
            onResponse: async (resp: ICNSResponseLike) => {
                const rec = toHopRecord(
                    job.id,
                    hopCount,
                    resp,
                    cns,
                    registry
                );
                hopCount += 1;
                // Returning a Promise makes CNStra wait for the durable write
                // before enqueuing the next hop (per-hop checkpoint barrier).
                await progress?.onHop?.(rec);
            },
        });

        try {
            await stimulation.waitUntilComplete();
            await progress?.onCompleted?.({
                jobId: job.id,
                collateralName,
                payload,
                status: 'completed',
                startedAt,
                completedAt: Date.now(),
                hopCount,
            });
        } catch (err) {
            await progress?.onCompleted?.({
                jobId: job.id,
                collateralName,
                payload,
                status: 'failed',
                startedAt,
                completedAt: Date.now(),
                hopCount,
                error: err instanceof Error ? err.message : String(err),
            });
            // Let pg-boss decide about retries/backoff.
            throw err;
        }
    };

    const handler = async (
        jobs: IPgBossJob<TCNSStimulationJobData>[]
    ): Promise<void> => {
        for (const job of jobs) {
            await runJob(job);
        }
    };

    return workOptions
        ? boss.work<TCNSStimulationJobData>(queue, workOptions, handler)
        : boss.work<TCNSStimulationJobData>(queue, handler);
}
