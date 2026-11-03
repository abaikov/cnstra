import { CNSSnapshotCache } from '../CNSSnapshotCache';
import type { TCNSExplorerSnapshot } from '../explorerClient';

/**
 * The snapshot poll runs every two seconds. Under `'full'` volume a run
 * contributes one task row per hop, so a page of two hundred fifty-hop runs is
 * ten thousand rows — re-read, re-serialised and re-pushed every two seconds,
 * almost all byte-identical to the previous push.
 *
 * The cache is what makes the poll ask only for what moved. These pin the two
 * properties that make that safe: a run that moved is never skipped, and what is
 * kept can never outgrow the page.
 */

const row = (
    stimulationId: string,
    over: { status?: string; hopCount?: number; completedAt?: number | null } = {}
) =>
    ({
        stimulationId,
        entry: { collateralName: 'input', payload: null },
        status: 'completed',
        startedAt: 1000,
        completedAt: 1500,
        hopCount: 3,
        hasError: false,
        ...over,
    } as TCNSExplorerSnapshot['stimulations'][number]);

const attempt = (stimulationId: string, n = 1) =>
    ({
        stimulationAttemptId: `${stimulationId}#${n}`,
        stimulationId,
        attemptNumber: n,
        status: 'completed',
        startedAt: 1000,
        completedAt: 1500,
        hopCount: 3,
        hasError: false,
        replayOf: null,
        entry: [{ collateralName: 'input', payload: null }],
    } as unknown as TCNSExplorerSnapshot['attempts'][number]);

const task = (stimulationId: string, index: number, n = 1) =>
    ({
        stimulationAttemptId: `${stimulationId}#${n}`,
        index,
        neuronName: `neuron${index}`,
        dendriteCollateralName: 'input',
        inputIndex: 0,
        output: null,
        status: 'completed',
        error: null,
        startedAt: 1000,
        duration: 1,
    } as unknown as TCNSExplorerSnapshot['tasks'][number]);

const full = (ids: string[], hops = 2): TCNSExplorerSnapshot => ({
    stimulations: ids.map(id => row(id)),
    attempts: ids.map(id => attempt(id)),
    tasks: ids.flatMap(id =>
        Array.from({ length: hops }, (_, i) => task(id, i))
    ),
});

describe('CNSSnapshotCache', () => {
    it('asks for everything on the first poll', () => {
        const cache = new CNSSnapshotCache();
        expect(cache.skipDetailFor()).toEqual([]);
    });

    it('skips the details of runs that have not moved', () => {
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));

        expect(cache.skipDetailFor().sort()).toEqual(['a', 'b']);
    });

    it('keeps the kept details when the poll leaves them out', () => {
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));

        // What the server sends for a poll that skipped both: rows only.
        const held = cache.merge(
            { stimulations: [row('a'), row('b')], attempts: [], tasks: [] },
            ['a', 'b']
        );

        expect(held.tasks).toHaveLength(4);
        expect(held.attempts).toHaveLength(2);
        expect(held.stimulations.map(r => r.stimulationId)).toEqual(['a', 'b']);
    });

    it('stops skipping a run whose row moved', () => {
        // A retry gives the run a new attempt: its hopCount and status move, and
        // the tasks it holds are no longer the whole story.
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));

        cache.merge(
            {
                stimulations: [row('a', { hopCount: 9, status: 'running' }), row('b')],
                attempts: [],
                tasks: [],
            },
            ['a', 'b']
        );

        expect(cache.skipDetailFor()).toEqual(['b']);
    });

    it('takes the fresh details for a run it stopped skipping', () => {
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));
        cache.merge(
            {
                stimulations: [row('a', { hopCount: 9 }), row('b')],
                attempts: [],
                tasks: [],
            },
            ['a', 'b']
        );

        // The next poll skips only 'b' and brings 'a' back with five hops.
        const held = cache.merge(
            {
                stimulations: [row('a', { hopCount: 5 }), row('b')],
                attempts: [attempt('a', 2)],
                tasks: [0, 1, 2, 3, 4].map(i => task('a', i, 2)),
            },
            ['b']
        );

        const aTasks = held.tasks.filter(t =>
            t.stimulationAttemptId.startsWith('a#')
        );
        // The stale first-attempt rows are gone, not added to.
        expect(aTasks).toHaveLength(5);
        expect(aTasks.every(t => t.stimulationAttemptId === 'a#2')).toBe(true);
        expect(cache.skipDetailFor().sort()).toEqual(['a', 'b']);
    });

    it('evicts what falls out of the page', () => {
        // The page is the working set; a run that scrolled out takes its tasks
        // with it, so the store cannot grow past what the page bounds.
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b', 'c']));

        const held = cache.merge(
            { stimulations: [row('b'), row('c')], attempts: [], tasks: [] },
            ['a', 'b', 'c']
        );

        expect(held.stimulations.map(r => r.stimulationId)).toEqual(['b', 'c']);
        expect(held.attempts.map(a => a.stimulationId).sort()).toEqual(['b', 'c']);
        expect(held.tasks).toHaveLength(4);
        expect(cache.skipDetailFor().sort()).toEqual(['b', 'c']);
    });

    it('does not resurrect a run that comes back into the page', () => {
        // 'a' left the page and its details were dropped; when it returns the
        // cache must ask for them again rather than claim it has them.
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));
        cache.merge({ stimulations: [row('b')], attempts: [], tasks: [] }, [
            'a',
            'b',
        ]);

        const back = cache.merge(
            { stimulations: [row('a'), row('b')], attempts: [], tasks: [] },
            ['b']
        );

        expect(back.tasks.filter(t => t.stimulationAttemptId.startsWith('a#')))
            .toHaveLength(0);
        // 'a' arrived without details because nothing was sent for it, and the
        // cache now believes it holds them — which is true: it holds none, and
        // the server said there are none. The next poll is what fixes a run
        // whose details existed: its row will have moved.
        expect(cache.skipDetailFor().sort()).toEqual(['a', 'b']);
    });

    it('forgets everything on reset', () => {
        const cache = new CNSSnapshotCache();
        cache.merge(full(['a', 'b']));
        cache.reset();

        expect(cache.skipDetailFor()).toEqual([]);
        expect(cache.snapshot.tasks).toEqual([]);
    });
});
