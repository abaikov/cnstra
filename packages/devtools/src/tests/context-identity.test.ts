import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNS, collateral, neuronFactory } from '@cnstra/core';
import { CNSPersistOptionsRegistry, CNSInMemoryStimulationRepository, CNS_JOB_IDENTITY_CONTEXT_KEY } from '@cnstra/persist';
import type { TCNSAppBatchMessageDTO } from '@cnstra/devtools-dto';

const build = () => {
    const entryCol = collateral<{ n: number }>();
    const doneCol = collateral<{ n: number }>();
    const worker = neuronFactory()
        .neuron({ doneCol })
        .bind({ entryCol }, { entryCol: ({ n }, axon) => axon.doneCol.createSignal({ n }) });
    const cns = new CNS([worker]);
    const registry = new CNSPersistOptionsRegistry();
    registry.register('worker', worker, { doneCol: 'done-col' }).registerCollateral('entry-col', entryCol);
    return { cns, registry, entryCol };
};

const recordInto = (repository: CNSInMemoryStimulationRepository): ICNSDevToolsTransport => ({
    async sendBatch(message: TCNSAppBatchMessageDTO) {
        for (const item of message.items) {
            if (item.type === 'cns.stimulation') await repository.saveStimulation(item.data);
            if (item.type === 'cns.stimulation.attempt') await repository.saveAttempt(item.data);
            if (item.type === 'cns.stimulation.task') await repository.appendTask(item.data);
        }
    },
});

describe('a stimulation that carries a job identity in its stimulationContext', () => {
    it('is recorded under that stimulation id and attempt number', async () => {
        const { cns, registry, entryCol } = build();
        const repository = new CNSInMemoryStimulationRepository();
        new CNSDevTools('test-app', recordInto(repository)).registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ n: 1 }), { stimulationContext: { [CNS_JOB_IDENTITY_CONTEXT_KEY]: { stimulationId: 'job-1', attemptNumber: 2 } } })
            .waitUntilComplete();
        await new Promise(resolve => setTimeout(resolve, 50));

        expect((await repository.listStimulations()).map(stimulation => stimulation.stimulationId)).toEqual(['job-1']);
        const attempts = await repository.getAttempts('job-1');
        expect(attempts.map(attempt => attempt.attemptNumber)).toEqual([2]);
        expect(attempts[0].stimulationAttemptId).toBe('job-1#2');
    });

    it('falls back to attempt 1 when the context has no usable attempt number', async () => {
        const { cns, registry, entryCol } = build();
        const repository = new CNSInMemoryStimulationRepository();
        new CNSDevTools('test-app', recordInto(repository)).registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ n: 1 }), { stimulationContext: { [CNS_JOB_IDENTITY_CONTEXT_KEY]: { stimulationId: 'job-2', attemptNumber: 0 } } })
            .waitUntilComplete();
        await new Promise(resolve => setTimeout(resolve, 50));

        expect((await repository.getAttempts('job-2')).map(attempt => attempt.attemptNumber)).toEqual([1]);
    });

    it('ignores a stimulationId the user put in the context for log correlation', async () => {
        const { cns, registry, entryCol } = build();
        const repository = new CNSInMemoryStimulationRepository();
        new CNSDevTools('test-app', recordInto(repository)).registerCNS(cns as any, registry);

        await cns
            .stimulate(entryCol.createSignal({ n: 1 }), { stimulationContext: { stimulationId: 'request-7' } })
            .waitUntilComplete();
        await cns
            .stimulate(entryCol.createSignal({ n: 2 }), { stimulationContext: { stimulationId: 'request-7' } })
            .waitUntilComplete();
        await new Promise(resolve => setTimeout(resolve, 50));

        const ids = (await repository.listStimulations()).map(stimulation => stimulation.stimulationId);
        expect(ids).toHaveLength(2);
        expect(ids).not.toContain('request-7');
    });
});
