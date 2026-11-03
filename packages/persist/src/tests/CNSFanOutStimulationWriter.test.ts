import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';

import { CNSFanOutStimulationWriter } from '.././CNSFanOutStimulationWriter';
import type { ICNSStimulationWriter } from '.././interfaces/ICNSStimulationRepository';

const state: TCNSStimulationState = {
    stimulationId: 'run-1',
    entry: { collateralName: 'order.created', payload: null },
    status: 'running',
    progress: { tasks: [] },
};

const attempt: TCNSStimulationAttempt = {
    stimulationAttemptId: 'run-1#1',
    stimulationId: 'run-1',
    attemptNumber: 1,
    status: 'running',
    startedAt: 1_000,
    completedAt: null,
    hopCount: 0,
    hasError: false,
    replayOf: null,
    entry: [{ collateralName: 'order.created', payload: null }],
};

const task: TCNSStimulationTask = {
    stimulationAttemptId: 'run-1#1',
    index: 1,
    neuronName: 'validate',
    dendriteCollateralName: 'order.created',
    inputIndex: 0,
    output: null,
    status: 'done',
    error: null,
    startedAt: 1_010,
    duration: null,
};

/** A writer that records what it was handed, and can be told to fail. */
const spyWriter = (behaviour?: { throws?: boolean; rejects?: boolean }) => {
    const calls: string[] = [];
    const fail = () => {
        if (behaviour?.throws) throw new Error('sink is down');
        if (behaviour?.rejects) return Promise.reject(new Error('sink is down'));
        return Promise.resolve();
    };

    const writer: ICNSStimulationWriter = {
        saveStimulation: async () => {
            calls.push('saveStimulation');
            return fail();
        },
        saveAttempt: async () => {
            calls.push('saveAttempt');
            return fail();
        },
        appendTask: async () => {
            calls.push('appendTask');
            return fail();
        },
        getStimulation: async () => {
            calls.push('getStimulation');
            return undefined;
        },
    };

    return { writer, calls };
};

describe('CNSFanOutStimulationWriter', () => {
    let errors: unknown[][];
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        errors = [];
        consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation((...args: unknown[]) => {
                errors.push(args);
            });
    });

    afterEach(() => consoleError.mockRestore());

    it('hands every write to every sink', async () => {
        const a = spyWriter();
        const b = spyWriter();
        const fanOut = new CNSFanOutStimulationWriter([a.writer, b.writer]);

        await fanOut.saveStimulation(state);
        await fanOut.saveAttempt(attempt);
        await fanOut.appendTask(task);

        expect(a.calls).toEqual([
            'saveStimulation',
            'saveAttempt',
            'appendTask',
        ]);
        expect(b.calls).toEqual(a.calls);
    });

    it('keeps writing to the other sinks when one rejects', async () => {
        const broken = spyWriter({ rejects: true });
        const healthy = spyWriter();
        const fanOut = new CNSFanOutStimulationWriter([
            broken.writer,
            healthy.writer,
        ]);

        await fanOut.appendTask(task);

        expect(healthy.calls).toEqual(['appendTask']);
        expect(errors).toHaveLength(1);
    });

    it('keeps writing when one sink throws synchronously', async () => {
        const broken = spyWriter({ throws: true });
        const healthy = spyWriter();
        const fanOut = new CNSFanOutStimulationWriter([
            broken.writer,
            healthy.writer,
        ]);

        await fanOut.saveAttempt(attempt);

        expect(healthy.calls).toEqual(['saveAttempt']);
        expect(errors).toHaveLength(1);
    });

    it('never rejects, so one dead sink cannot fail a run', async () => {
        const fanOut = new CNSFanOutStimulationWriter([
            spyWriter({ rejects: true }).writer,
        ]);

        await expect(fanOut.saveStimulation(state)).resolves.toBeUndefined();
    });

    it('reads from the first sink that has the stimulation', async () => {
        const empty = spyWriter();
        const holder: ICNSStimulationWriter = {
            ...spyWriter().writer,
            getStimulation: async () => state,
        };
        const later = spyWriter();

        const fanOut = new CNSFanOutStimulationWriter([
            empty.writer,
            holder,
            later.writer,
        ]);

        await expect(fanOut.getStimulation('run-1')).resolves.toBe(state);
        expect(empty.calls).toEqual(['getStimulation']);
        // Once a sink answered there is nothing to ask the rest.
        expect(later.calls).toEqual([]);
    });

    it('resolves to undefined when no sink has it', async () => {
        const fanOut = new CNSFanOutStimulationWriter([
            spyWriter().writer,
            spyWriter().writer,
        ]);

        await expect(fanOut.getStimulation('run-1')).resolves.toBeUndefined();
    });

    it('survives a sink that fails on read', async () => {
        const broken: ICNSStimulationWriter = {
            ...spyWriter().writer,
            getStimulation: async () => {
                throw new Error('sink is down');
            },
        };
        const holder: ICNSStimulationWriter = {
            ...spyWriter().writer,
            getStimulation: async () => state,
        };

        const fanOut = new CNSFanOutStimulationWriter([broken, holder]);

        await expect(fanOut.getStimulation('run-1')).resolves.toBe(state);
        expect(errors).toHaveLength(1);
    });

    it('is a no-op with no sinks at all', async () => {
        const fanOut = new CNSFanOutStimulationWriter([]);

        await expect(fanOut.appendTask(task)).resolves.toBeUndefined();
        await expect(fanOut.getStimulation('run-1')).resolves.toBeUndefined();
    });
});
