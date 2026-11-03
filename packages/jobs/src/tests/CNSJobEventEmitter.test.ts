import { describe, expect, it } from '@jest/globals';
import { CNSJobEventEmitter } from '../events/CNSJobEventEmitter';
import type { TCNSJobEvent } from '../types/TCNSJobEvent';

describe('CNSJobEventEmitter', () => {
    it('delivers to listeners of the name and to wildcard listeners', () => {
        const emitter = new CNSJobEventEmitter(() => undefined);
        const named: string[] = [];
        const all: string[] = [];
        emitter.on('job.completed', event => named.push(event.name));
        emitter.on('*', event => all.push(event.name));

        emitter.emit({ name: 'job.completed', jobId: '1' });
        emitter.emit({ name: 'job.failed', jobId: '2' });

        expect(named).toEqual(['job.completed']);
        expect(all).toEqual(['job.completed', 'job.failed']);
    });

    it('stops delivering after unsubscribe', () => {
        const emitter = new CNSJobEventEmitter(() => undefined);
        const seen: string[] = [];
        const off = emitter.on('job.completed', event => seen.push(event.jobId ?? ''));

        emitter.emit({ name: 'job.completed', jobId: '1' });
        off();
        emitter.emit({ name: 'job.completed', jobId: '2' });

        expect(seen).toEqual(['1']);
    });

    it('reports a throwing listener and keeps delivering to the rest', () => {
        const errors: Array<[unknown, TCNSJobEvent]> = [];
        const emitter = new CNSJobEventEmitter((error, event) => errors.push([error, event]));
        const seen: string[] = [];
        emitter.on('job.completed', () => {
            throw new Error('listener');
        });
        emitter.on('job.completed', event => seen.push(event.jobId ?? ''));

        emitter.emit({ name: 'job.completed', jobId: '1' });

        expect(seen).toEqual(['1']);
        expect(errors).toHaveLength(1);
        expect((errors[0][0] as Error).message).toBe('listener');
        expect(errors[0][1].jobId).toBe('1');
    });
});
