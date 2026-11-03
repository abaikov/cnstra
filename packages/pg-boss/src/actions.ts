import type { TCNSDevToolsActionMiddleware } from '@cnstra/persist-dto';
import type { ICNSPgBossLike, TCNSStimulationJobData } from './types';

/** The two calls this needs beyond `send` — kept structural, like the rest. */
export interface ICNSPgBossActionsLike extends ICNSPgBossLike {
    getJobById(
        name: string,
        id: string
    ): Promise<{ id: string; state?: string } | null | undefined>;
    retry(name: string, id: string): Promise<unknown>;
}

/**
 * Carries out DevTools actions against a pg-boss queue.
 *
 * Same shape as the BullMQ adapter and for the same reason: **retry is the
 * broker's own retry**, keyed by the job id — which is our `stimulationId` — so
 * the run keeps its identity, its history and its resume checkpoint. A clone or
 * a replay is a new job under a new id.
 *
 * Ownership is decided by asking pg-boss whether it holds the job; anything else
 * falls through to the next link in the chain.
 */
export const createCNSPgBossActions = (
    boss: ICNSPgBossActionsLike,
    queue: string
): TCNSDevToolsActionMiddleware => {
    return async (action, next) => {
        if (action.type === 'command') return next();
        if (action.type === 'launch') {
            const data: TCNSStimulationJobData = {
                collateralName: action.entry.collateralName,
                payload: action.entry.payload,
                ...(action.options?.maxHops
                    ? { maxNeuronHops: action.options.maxHops }
                    : {}),
            };
            await boss.send(queue, data, {
                id: action.stimulationId,
            });
            return;
        }

        const job = await boss.getJobById(queue, action.stimulationId);
        // Not ours: another queue, or a run that never came from a broker.
        if (!job) return next();

        await boss.retry(queue, action.stimulationId);
    };
};
