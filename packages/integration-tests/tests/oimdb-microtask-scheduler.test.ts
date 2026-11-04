import { OIMEventQueue, OIMReactiveCollection } from '@oimdb/core';
import { CNS, collateral, neuron } from '@cnstra/core';

/**
 * onDrain is synchronous by default - the flush lands before stimulate()
 * returns. If a consumer would rather coalesce several turns' flushes into one,
 * that is an adapter-side choice: schedule the flush on a microtask instead of
 * running it inline. The core stays out of it.
 */

type Row = { id: string; n: number };

describe('OIMDB: choosing the flush cadence at the adapter', () => {
    const build = () => {
        const queue = new OIMEventQueue();
        const rows = new OIMReactiveCollection<Row, string>(queue, {
            selectPk: r => r.id,
        });
        const tick = collateral<number>();
        // Sync graph: three neurons -> three turns is NOT what happens; a single
        // synchronous cascade is one turn. We drive three SEPARATE stimulations
        // to get three turns in one microtask window.
        const bump = neuron({}).dendrite({
            collateral: tick,
            response: p => {
                rows.upsertOneByPk('r1', { id: 'r1', n: p as number });
                return undefined;
            },
        });
        const cns = new CNS([bump]);
        return { cns, queue, rows, tick };
    };

    it('default: one synchronous flush per turn, before stimulate() returns', () => {
        const { cns, queue, rows, tick } = build();
        const off = cns.addDrainListener(() => queue.flush());

        let notifications = 0;
        rows.subscribeOnKey('r1', () => { notifications++; });

        cns.stimulate(tick.createSignal(1));
        // No await: the flush already happened inside stimulate().
        expect(notifications).toBe(1);

        cns.stimulate(tick.createSignal(2));
        expect(notifications).toBe(2);

        off();
    });

    it('opt-in: a microtask scheduler coalesces several turns into one flush', async () => {
        const { cns, queue, rows, tick } = build();

        // Adapter-side coalescing: mark dirty on each drain, flush once on the
        // trailing microtask. The core still fires a drain per turn; the adapter
        // decides the cadence.
        let scheduled = false;
        const off = cns.addDrainListener(() => {
            if (scheduled) return;
            scheduled = true;
            queueMicrotask(() => {
                scheduled = false;
                queue.flush();
            });
        });

        let notifications = 0;
        rows.subscribeOnKey('r1', () => { notifications++; });

        // Three separate stimulations, three synchronous turns, three drains -
        // all in the same microtask window.
        cns.stimulate(tick.createSignal(1));
        cns.stimulate(tick.createSignal(2));
        cns.stimulate(tick.createSignal(3));

        // Nothing has flushed yet - the flush is queued behind the current stack.
        expect(notifications).toBe(0);

        await Promise.resolve();

        // Three turns collapsed into a single flush, carrying the final write.
        expect(notifications).toBe(1);
        expect(rows.getOneByPk('r1')?.n).toBe(3);

        off();
    });
});
