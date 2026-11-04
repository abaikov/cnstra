import { CNS, afferentPath, collateral, modality, neuron } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { ICNSStimulation } from '@cnstra/types';
import { stimulationJob } from '../stimulationJob';
import { runCNSStimulationJob } from '../runCNSStimulationJob';
import type { TCNSStimulationJobData } from '../types';

const buildFlow = () => {
    const kickoff = collateral<undefined>();
    const createDeck = collateral<{ title: string }>();
    const ui = afferentPath();
    const onboarding = afferentPath();
    const flow = modality({ ui, onboarding });
    const ran: string[] = [];
    const enqueued: TCNSStimulationJobData[] = [];

    const registry = new CNSPersistOptionsRegistry();
    const deckCreator = neuron({}).modalityDendrite({
        collateral: createDeck,
        modality: flow,
        afferentPaths: new Map([[onboarding, () => { ran.push('onboarding'); }]]),
        default: () => { ran.push('default'); },
        output: () => undefined,
    });
    const scheduler = neuron({}).dendrite({
        collateral: kickoff,
        response: (_payload, _axon, ctx) => {
            enqueued.push(stimulationJob(registry, createDeck, { title: 'Spanish' }, { from: ctx }));
        },
    });
    registry.register('deckCreator', deckCreator);
    registry.register('scheduler', scheduler);
    registry.registerCollateral('createDeck', createDeck);
    registry.registerCollateral('kickoff', kickoff);
    registry.registerModality('flow', flow);

    return { cns: new CNS([deckCreator, scheduler]), registry, kickoff, createDeck, flow, onboarding, ran, enqueued };
};

const runJob = (world: ReturnType<typeof buildFlow>, job: TCNSStimulationJobData) => runCNSStimulationJob({
    pkgName: '@cnstra/test',
    stopping: false,
    cns: world.cns,
    registry: world.registry,
    jobId: 'job-1',
    attemptNumber: 1,
    abort: new AbortController(),
    active: new Set<ICNSStimulation<any>>(),
    ...job,
});

describe('a job started on an afferent path', () => {
    it('carries an explicit modality and path by name', () => {
        const world = buildFlow();

        const job = stimulationJob(world.registry, world.createDeck, { title: 'a' }, { modality: world.flow, afferentPath: world.onboarding });

        expect(job).toEqual({ collateralName: 'createDeck', payload: { title: 'a' }, modalityName: 'flow', afferentPathName: 'onboarding' });
    });

    it('inherits the modality and path of the run that enqueues it', async () => {
        const world = buildFlow();

        await world.cns.stimulate(world.kickoff.createSignal(), { modality: world.flow, afferentPath: world.onboarding }).waitUntilComplete();

        expect(world.enqueued).toEqual([{ collateralName: 'createDeck', payload: { title: 'Spanish' }, modalityName: 'flow', afferentPathName: 'onboarding' }]);
    });

    it('runs in the worker on the same path', async () => {
        const world = buildFlow();

        await runJob(world, stimulationJob(world.registry, world.createDeck, { title: 'a' }, { modality: world.flow, afferentPath: world.onboarding }));
        await runJob(world, stimulationJob(world.registry, world.createDeck, { title: 'b' }));

        expect(world.ran).toEqual(['onboarding', 'default']);
    });

    it('refuses to enqueue a modality that is not registered', () => {
        const world = buildFlow();
        const unregistered = modality({ elsewhere: afferentPath() });

        expect(() => stimulationJob(world.registry, world.createDeck, { title: 'a' }, { modality: unregistered })).toThrow(/Modality is not registered/);
    });
});
