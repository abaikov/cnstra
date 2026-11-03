import { cnsRunAll, createCNSRunQueue } from '../index';

describe('running every function of a drain', () => {
    it('runs every function, throws the first error and throws every later one in its own microtask', async () => {
        const ran: string[] = [];
        const laterErrors: unknown[] = [];
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(task => {
            try {
                task();
            } catch (error) {
                laterErrors.push(error);
            }
        });

        expect(() => cnsRunAll([
            () => { ran.push('first'); throw new Error('first'); },
            () => { ran.push('second'); throw new Error('second'); },
            () => { ran.push('third'); throw new Error('third'); },
            () => { ran.push('fourth'); },
        ])).toThrow('first');
        queueMicrotaskSpy.mockRestore();

        expect(ran).toEqual(['first', 'second', 'third', 'fourth']);
        expect(laterErrors).toEqual([new Error('second'), new Error('third')]);
    });

    it('drains a run queue with the same rule', () => {
        let runQueued: () => void = () => undefined;
        const laterErrors: unknown[] = [];
        const runOutside = createCNSRunQueue(scheduledRunQueued => { runQueued = scheduledRunQueued; });
        runOutside(() => { throw new Error('first'); });
        runOutside(() => { throw new Error('second'); });
        const queueMicrotaskSpy = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(task => {
            try {
                task();
            } catch (error) {
                laterErrors.push(error);
            }
        });

        expect(() => runQueued()).toThrow('first');
        queueMicrotaskSpy.mockRestore();

        expect(laterErrors).toEqual([new Error('second')]);
    });
});
