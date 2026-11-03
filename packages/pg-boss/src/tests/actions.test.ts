import { runCNSDevToolsAction } from '@cnstra/persist-dto';
import type { TCNSDevToolsAction } from '@cnstra/persist-dto';

import { createCNSPgBossActions } from '.././actions';
import type { ICNSPgBossActionsLike } from '.././actions';

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

const fakeBoss = (known: string[]) => {
    const sent: Array<{ queue: string; data: any; options: any }> = [];
    const retried: Array<{ queue: string; id: string }> = [];

    const boss = {
        async send(queue: string, data: object, options?: any) {
            sent.push({ queue, data, options });
            return 'job-id';
        },
        async getJobById(_queue: string, id: string) {
            return known.includes(id) ? { id, state: 'failed' } : null;
        },
        async retry(queue: string, id: string) {
            retried.push({ queue, id });
        },
    } as unknown as ICNSPgBossActionsLike;

    return { boss, sent, retried };
};

describe('createCNSPgBossActions', () => {
    it('retries through the broker, under the same job id', async () => {
        const b = fakeBoss(['order-42']);

        const handled = await runCNSDevToolsAction(
            [createCNSPgBossActions(b.boss, 'cns')],
            resume()
        );

        expect(handled).toBe(true);
        expect(b.retried).toEqual([{ queue: 'cns', id: 'order-42' }]);
        expect(b.sent).toEqual([]);
    });

    it('passes a run it does not own to the next link', async () => {
        const b = fakeBoss([]);
        const seen: string[] = [];

        await runCNSDevToolsAction(
            [
                createCNSPgBossActions(b.boss, 'cns'),
                async action => void seen.push(action.stimulationId),
            ],
            resume('came-from-bull')
        );

        expect(seen).toEqual(['came-from-bull']);
        expect(b.retried).toEqual([]);
    });

    it('passes a command on to the next link', async () => {
        const b = fakeBoss([]);
        const seen: string[] = [];

        await runCNSDevToolsAction(
            [createCNSPgBossActions(b.boss, 'cns'), async action => void seen.push(action.type)],
            { type: 'command', requestId: 'req-1', stimulationId: 'order-42', command: { name: 'runNow' } }
        );

        expect(seen).toEqual(['command']);
        expect(b.retried).toEqual([]);
    });

    it('sends a clone as a new job under the new id', async () => {
        const b = fakeBoss([]);

        const handled = await runCNSDevToolsAction(
            [createCNSPgBossActions(b.boss, 'cns')],
            launch()
        );

        expect(handled).toBe(true);
        expect(b.sent).toHaveLength(1);
        expect(b.sent[0].options).toMatchObject({ id: 'order-42-clone-1-a' });
        expect(b.sent[0].data).toEqual({
            collateralName: 'order.created',
            payload: { id: 7 },
        });
    });

    it('two brokers in one chain each take only their own runs', async () => {
        // The point of the chain: one panel over a deployment whose runs come
        // from more than one place.
        const mine = fakeBoss(['order-42']);
        const theirs = fakeBoss(['other-99']);

        await runCNSDevToolsAction(
            [
                createCNSPgBossActions(mine.boss, 'orders'),
                createCNSPgBossActions(theirs.boss, 'billing'),
            ],
            resume('other-99')
        );

        expect(mine.retried).toEqual([]);
        expect(theirs.retried).toEqual([{ queue: 'billing', id: 'other-99' }]);
    });
});
