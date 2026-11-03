import { runCNSDevToolsAction } from '@cnstra/persist-dto';
import type { TCNSDevToolsAction } from '@cnstra/persist-dto';

import { createCNSBullActions } from '.././actions';
import type { ICNSBullActionJob, ICNSBullActionQueueLike } from '.././actions';

const resume = (id = 'order-42'): TCNSDevToolsAction => ({
    type: 'resume',
    requestId: 'req-1',
    stimulationId: id,
    stimulationAttemptId: `${id}#2`,
    attemptNumber: 2,
    entry: { collateralName: 'order.created', payload: { id: 7 } },
    progress: { tasks: [] },
});

const launch = (id = 'order-42-clone-1-a'): TCNSDevToolsAction => ({
    type: 'launch',
    requestId: 'req-1',
    stimulationId: id,
    stimulationAttemptId: `${id}#1`,
    entry: { collateralName: 'order.created', payload: { id: 7 } },
});

const fakeQueue = (jobs: Record<string, string>) => {
    const added: Array<{ name: string; data: any; opts: any }> = [];
    const retried: Array<{ id: string; state?: string }> = [];

    const queue: ICNSBullActionQueueLike = {
        async add(name, data, opts) {
            added.push({ name, data, opts });
            return {} as never;
        },
        async getJob(jobId) {
            if (!(jobId in jobs)) return undefined;
            const job: ICNSBullActionJob = {
                id: jobId,
                name: 'cns-stimulation',
                data: {},
                async getState() {
                    return jobs[jobId];
                },
                async retry(state) {
                    retried.push({ id: jobId, state });
                },
            } as ICNSBullActionJob;
            return job;
        },
    };

    return { queue, added, retried };
};

describe('createCNSBullActions', () => {
    it('retries a failed job through the broker, keeping its id', async () => {
        // Not a re-add: BullMQ dedups by job id, and the id IS the stimulation id.
        const q = fakeQueue({ 'order-42': 'failed' });

        const handled = await runCNSDevToolsAction(
            [createCNSBullActions(q.queue)],
            resume()
        );

        expect(handled).toBe(true);
        expect(q.retried).toEqual([{ id: 'order-42', state: 'failed' }]);
        expect(q.added).toEqual([]);
    });

    it('re-runs a completed job too — that is what a rerun of a finished run is', async () => {
        const q = fakeQueue({ 'order-42': 'completed' });

        await runCNSDevToolsAction([createCNSBullActions(q.queue)], resume());

        expect(q.retried).toEqual([{ id: 'order-42', state: 'completed' }]);
    });

    it('passes a run it does not own to the next link', async () => {
        const q = fakeQueue({});
        const seen: string[] = [];

        const handled = await runCNSDevToolsAction(
            [
                createCNSBullActions(q.queue),
                async action => {
                    seen.push(action.stimulationId);
                },
            ],
            resume('came-from-http')
        );

        expect(handled).toBe(true);
        expect(seen).toEqual(['came-from-http']);
        expect(q.retried).toEqual([]);
    });

    it('passes a command on to the next link, even for a job it holds', async () => {
        const q = fakeQueue({ 'order-42': 'waiting' });
        const seen: string[] = [];

        await runCNSDevToolsAction(
            [createCNSBullActions(q.queue), async action => void seen.push(action.type)],
            { type: 'command', requestId: 'req-1', stimulationId: 'order-42', command: { name: 'cancel' } }
        );

        expect(seen).toEqual(['command']);
        expect(q.retried).toEqual([]);
        expect(q.added).toEqual([]);
    });

    it('claims a job that is already queued without pushing it twice', async () => {
        const q = fakeQueue({ 'order-42': 'waiting' });
        const seen: string[] = [];

        const handled = await runCNSDevToolsAction(
            [
                createCNSBullActions(q.queue),
                async action => void seen.push(action.stimulationId),
            ],
            resume()
        );

        // Claimed: no later link may re-run work that is already going to happen.
        expect(handled).toBe(true);
        expect(seen).toEqual([]);
        expect(q.retried).toEqual([]);
        expect(q.added).toEqual([]);
    });

    it('enqueues a clone as a NEW job under the new id', async () => {
        const q = fakeQueue({});

        const handled = await runCNSDevToolsAction(
            [createCNSBullActions(q.queue)],
            launch()
        );

        expect(handled).toBe(true);
        expect(q.added).toHaveLength(1);
        expect(q.added[0].opts).toMatchObject({ jobId: 'order-42-clone-1-a' });
        expect(q.added[0].data).toEqual({
            collateralName: 'order.created',
            payload: { id: 7 },
        });
    });

    it('carries a hop cap from the action into the job payload', async () => {
        const q = fakeQueue({});

        await runCNSDevToolsAction([createCNSBullActions(q.queue)], {
            ...launch(),
            options: { maxHops: 12 },
        } as TCNSDevToolsAction);

        expect(q.added[0].data).toMatchObject({ maxNeuronHops: 12 });
    });
});
