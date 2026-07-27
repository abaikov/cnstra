import type { TStimulation, UIHop } from '../model';
import type { TCNSDurableRunView } from './TCNSDurableRunView';

/**
 * Translate a name-based run view (Stimulation → Attempt → Task, all by name) into
 * the panel's id-shaped OIMDB entities the graph / analytics / details / performance
 * views read. This is the ONLY place name→id reconstruction happens; it is robust
 * because a run view is a COMPLETE snapshot (whole run at once, `scopeName` = cnsId)
 * and the panel already holds topology, so ids match the graph exactly:
 *   neuron id      = `${cnsId}:${neuronName}`
 *   collateral id  = topology id looked up by name, else `${cnsId}:external:${name}`
 *
 * Each attempt's tasks become hops of one stimulation keyed by the STABLE run id
 * (so re-polling upserts in place). The latest attempt wins for the stimulation's
 * status/timestamps.
 */
export interface TranslateCtx {
    cnsId: string;
    appId: string;
    /** collateralName → topology collateral id (within this cns/app). */
    collateralIdByName: (name: string) => string | undefined;
}

export interface TranslatedRun {
    stimulation: TStimulation;
    hops: UIHop[];
}

export function translateRunView(
    run: TCNSDurableRunView,
    ctx: TranslateCtx
): TranslatedRun {
    const { cnsId, appId } = ctx;
    const colId = (name: string | undefined | null): string =>
        (name ? ctx.collateralIdByName(name) : undefined) ??
        `${cnsId}:external:${name ?? 'unknown'}`;

    // The last attempt carries the run's current status/timestamps.
    const lastAttempt = run.attempts[run.attempts.length - 1];
    const firstAttempt = run.attempts[0];
    const startedAt = firstAttempt?.startedAt ?? 0;
    const completedAt =
        run.status === 'running'
            ? null
            : (lastAttempt?.completedAt ?? null);
    const hopCount = run.attempts.reduce((n, a) => n + a.tasks.length, 0);

    const stimulation: TStimulation = {
        id: run.runId,
        cnsId,
        appId,
        collateralId: colId(run.entry.collateralName),
        payload: run.entry.payload,
        startedAt,
        completedAt,
        hopCount,
        hasError: run.status === 'failed',
        replayOf: null,
        stimulationRunId: run.runId,
        attemptNumber: lastAttempt?.attemptNumber ?? 1,
        collateralName: run.entry.collateralName,
    };

    const hops: UIHop[] = [];
    for (const a of run.attempts) {
        for (const t of a.tasks) {
            hops.push({
                // Stable per (run, attempt, task index) so re-polls upsert in place.
                id: `${run.runId}#${a.attemptNumber}:${t.index}`,
                stimulationId: run.runId,
                appId,
                index: t.index,
                neuronId: `${cnsId}:${t.neuronName}`,
                inputCollateralId: colId(t.dendriteCollateralName),
                outputCollateralId: t.output
                    ? colId(t.output.collateralName)
                    : null,
                inputPayload: null,
                outputPayload: t.output ? t.output.payload : null,
                startedAt: t.startedAt ?? startedAt,
                duration: t.duration ?? null,
                error: t.error,
                neuronName: t.neuronName,
                inputCollateralName: t.dendriteCollateralName ?? null,
                outputCollateralName: t.output?.collateralName ?? null,
            });
        }
    }

    return { stimulation, hops };
}
