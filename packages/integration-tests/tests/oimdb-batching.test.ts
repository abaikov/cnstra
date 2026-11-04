import { OIMEventQueue, OIMReactiveCollection } from '@oimdb/core';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * Verifies the "Batching state managers" recipe against real OIMDB.
 *
 * An OIMEventQueue built without a scheduler never flushes itself, so CNStra can
 * take the scheduler's place: writes land in the collection immediately and
 * subscribers are notified once per synchronous turn.
 */

type User = { id: string; name?: string; loading?: boolean };

const setup = (cns: CNS<any, any>) => {
    const queue = new OIMEventQueue(); // no scheduler - CNStra is the scheduler
    const users = new OIMReactiveCollection<User, string>(queue, {
        selectPk: u => u.id!,
    });
    const off = cns.addDrainListener(() => queue.flush());
    return { queue, users, dispose: off };
};

describe('OIMDB driven by onDrain', () => {
    it('never notifies on its own without a scheduler', async () => {
        const cns = new CNS([]);
        const queue = new OIMEventQueue();
        const users = new OIMReactiveCollection<User, string>(queue, {
            selectPk: u => u.id!,
        });

        let notifications = 0;
        users.subscribeOnKey('u1', () => { notifications++; });
        users.upsertOneByPk('u1', { id: 'u1', name: 'a' });

        await new Promise(r => setTimeout(r, 10));
        // No scheduler, no flush: the notification is still pending.
        expect(notifications).toBe(0);
        // The write itself is not deferred.
        expect(users.getOneByPk('u1')?.name).toBe('a');

        queue.flush();
        expect(notifications).toBe(1);
    });

    it('collapses a whole synchronous turn into one notification', async () => {
        const start = collateral<number>();
        const second = collateral<number>();
        const third = collateral<number>();

        let readInsideTurn: string | undefined;

        const cns = new CNS([
            neuron({ second }).dendrite({
                collateral: start,
                response: (_p, axon) => {
                    users.upsertOneByPk('u1', { id: 'u1', name: 'a' });
                    return axon.second.createSignal(1);
                },
            }),
            neuron({ third }).dendrite({
                collateral: second,
                response: (_p, axon) => {
                    users.upsertOneByPk('u1', { id: 'u1', name: 'b' });
                    return axon.third.createSignal(1);
                },
            }),
            neuron({}).dendrite({
                collateral: third,
                response: () => {
                    users.upsertOneByPk('u1', { id: 'u1', name: 'c' });
                    // Deferring notification must not defer the write.
                    readInsideTurn = users.getOneByPk('u1')?.name;
                    return undefined;
                },
            }),
        ]);
        const { users, dispose } = setup(cns);

        const seen: (string | undefined)[] = [];
        users.subscribeOnKey('u1', () => {
            seen.push(users.getOneByPk('u1')?.name);
        });

        await cns.stimulate(start.createSignal(0)).waitUntilComplete();
        dispose();

        expect(readInsideTurn).toBe('c');
        // Three writes across three neurons, one notification for the turn.
        expect(seen).toEqual(['c']);
    });

    it('surfaces an optimistic write made before an await', async () => {
        const click = collateral<number>();
        const done = collateral<number>();

        const cns = new CNS([
            neuron({ done }).dendrite({
                collateral: click,
                response: async (_p, axon) => {
                    // Written before yielding - the case a queueLength-driven
                    // flush would miss entirely.
                    users.upsertOneByPk('u1', { id: 'u1', loading: true });
                    await new Promise(r => setTimeout(r, 5));
                    return axon.done.createSignal(1);
                },
            }),
            neuron({}).dendrite({
                collateral: done,
                response: () => {
                    users.upsertOneByPk('u1', {
                        id: 'u1',
                        loading: false,
                        name: 'loaded',
                    });
                    return undefined;
                },
            }),
        ]);
        const { users, dispose } = setup(cns);

        const seen: string[] = [];
        users.subscribeOnKey('u1', () => {
            const u = users.getOneByPk('u1');
            seen.push(`${u?.loading}/${u?.name ?? '-'}`);
        });

        await cns.stimulate(click.createSignal(0)).waitUntilComplete();
        dispose();

        // One notification per synchronous turn, and the optimistic write is
        // visible at the first boundary rather than swallowed by the await.
        expect(seen).toEqual(['true/-', 'false/loaded']);
    });

    it('stops flushing once the listener is removed', async () => {
        const a = collateral<number>();
        const cns = new CNS([
            neuron({}).dendrite({
                collateral: a,
                response: () => {
                    users.upsertOneByPk('u1', { id: 'u1', name: 'x' });
                    return undefined;
                },
            }),
        ]);
        const { users, dispose } = setup(cns);

        let notifications = 0;
        users.subscribeOnKey('u1', () => { notifications++; });

        await cns.stimulate(a.createSignal(0)).waitUntilComplete();
        expect(notifications).toBe(1);

        dispose();
        await cns.stimulate(a.createSignal(0)).waitUntilComplete();
        // Unsubscribed: the queue is no longer driven by the drain.
        expect(notifications).toBe(1);
    });
});
