import { CNS, cnsNeuron } from '@cnstra/core';
import { autorun, observable, runInAction } from 'mobx';
import { CNSHomeostatReceptor, CNSHomeostatReceptorCorrection } from '@cnstra/sync';
import { createCNSMobXHomeostatEnvironment } from '../index';
import type { TCNSHomeostatConformanceDeck as TDeck } from '../../../sync/src/tests/conformance/cnsHomeostatConformance';
import { cnsSettleMicrotasks } from '../../../sync/src/tests/support/cnsHomeostatTestSupport';

const settle = () => cnsSettleMicrotasks();

const createApp = () => {
    const server = { titles: { d1: 'first' } as Record<string, string>, requested: [] as string[] };
    const decks = observable.map<string, TDeck>();
    const deckReceptor = new CNSHomeostatReceptor<[deckId: string], TDeck>({
        name: 'deck',
        transduce: ([deckId]) => {
            server.requested.push(deckId);
            if (server.requested.length > 20) return new Promise<TDeck>(() => undefined);
            return Promise.resolve({ id: deckId, title: server.titles[deckId] ?? `deck ${deckId}` });
        },
    });
    const deckWriter = cnsNeuron({}).dendrite({
        collateral: deckReceptor.axon.homeostasisRestored,
        response: ({ data }) => { decks.set(data.id, data); },
    });
    const cns = new CNS([deckReceptor.neuron, new CNSHomeostatReceptorCorrection({ homeostatReceptors: [deckReceptor] }).neuron, deckWriter]);
    const homeostatEnvironment = createCNSMobXHomeostatEnvironment({ cns });
    return { server, decks, deckReceptor, homeostatEnvironment };
};

describe('homeostat queries on MobX in an app', () => {
    it('a component that asks for its query on every render requests once', async () => {
        const app = createApp();
        const renders: string[] = [];
        const renderedComputeds = new Set<unknown>();
        const dispose = autorun(() => {
            const deckHomeostasisComputed = app.homeostatEnvironment.createComputed(app.deckReceptor, ['d1']);
            renderedComputeds.add(deckHomeostasisComputed);
            const deckHomeostasis = deckHomeostasisComputed.get();
            renders.push(`${deckHomeostasis.status}:${app.decks.get('d1')?.title ?? '-'}`);
        });
        await settle();
        await settle();
        expect(app.server.requested).toEqual(['d1']);
        expect(renders).toEqual(['firing:-', 'restored:first']);
        expect(renderedComputeds.size).toBe(1);
        dispose();
        expect(renderedComputeds.has(app.homeostatEnvironment.createComputed(app.deckReceptor, ['d1']))).toBe(false);
    });

    it('a route loader: start the query, wait for the data, hand the query over to the page', async () => {
        const app = createApp();
        const deckHomeostasis = app.homeostatEnvironment.createComputed(app.deckReceptor, ['d1']);
        const disposeLoader = autorun(() => { deckHomeostasis.get(); });
        await deckHomeostasis.get().homeostatRunningFiring?.waitUntilSettled();
        expect(app.decks.get('d1')?.title).toBe('first');
        const pageRenders: string[] = [];
        const disposePage = autorun(() => {
            pageRenders.push(app.homeostatEnvironment.createComputed(app.deckReceptor, ['d1']).get().status);
        });
        runInAction(() => disposeLoader());
        await settle();
        expect(pageRenders).toEqual(['restored']);
        expect(app.server.requested).toEqual(['d1']);
        disposePage();
    });
});
