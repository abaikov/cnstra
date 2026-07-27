import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { collateral, withCtx } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { CNSDTOAppBatchMessage, CNSDTOAppBatchItem } from '@cnstra/devtools-dto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRegistry() {
    const outputCol = collateral<{ data: string }>();
    const inputCol = collateral<{ query: string }>();
    const testNeuron = withCtx()
        .neuron({ outputCol })
        .bind({ inputCol }, { inputCol: (_, axon) => axon.outputCol.createSignal({ data: 'out' }) });

    const registry = new CNSPersistOptionsRegistry();
    registry
        .register('testNeuron', testNeuron, { outputCol: 'output-col' })
        .registerCollateral('input-col', inputCol);

    return { registry, testNeuron, outputCol, inputCol };
}

type StimulationMock = {
    waitUntilComplete: () => Promise<void>;
    resolve: () => void;
};

function makeStimulationMock(): StimulationMock {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { waitUntilComplete: () => promise, resolve };
}

class MockCNS {
    private listeners: Array<(r: any) => void> = [];
    network = {
        getParentNeuronByCollateral: () => null,
        getSubscribers: () => [],
    };

    addResponseListener(fn: (r: any) => void) {
        this.listeners.push(fn);
        return () => { this.listeners.splice(this.listeners.indexOf(fn), 1); };
    }

    stimulate(_signal: any, _opts?: any) {
        const mock = makeStimulationMock();
        return mock;
    }

    trigger(response: any) {
        this.listeners.forEach(fn => fn(response));
    }
}

class CaptureBatchTransport implements ICNSDevToolsTransport {
    batches: CNSDTOAppBatchMessage[] = [];

    async sendBatch(message: CNSDTOAppBatchMessage): Promise<void> {
        this.batches.push(message);
    }

    allItems(): CNSDTOAppBatchItem[] {
        return this.batches.flatMap(b => b.items);
    }

    itemsOfType<T extends CNSDTOAppBatchItem['type']>(type: T): Extract<CNSDTOAppBatchItem, { type: T }>[] {
        return this.allItems().filter((i): i is Extract<CNSDTOAppBatchItem, { type: T }> => i.type === type);
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CNSDevTools', () => {

    describe('topology', () => {
        it('sends topology batch on registerCNS', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);
            await new Promise(r => setTimeout(r, 0));

            const topologies = transport.itemsOfType('topology');
            expect(topologies).toHaveLength(1);
            expect(topologies[0].appId).toBe('app');
            expect(topologies[0].neurons).toHaveLength(1);
            expect(topologies[0].neurons[0].name).toBe('testNeuron');
            expect(topologies[0].collaterals).toHaveLength(1);
            expect(topologies[0].collaterals[0].name).toBe('output-col');
            expect(topologies[0].dendrites).toHaveLength(1);
        });

        it('sets correct IDs in topology', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();

            new CNSDevTools('myApp', transport, { cnsId: 'myApp:core' })
                .registerCNS(cns as any, registry);
            await new Promise(r => setTimeout(r, 0));

            const [topo] = transport.itemsOfType('topology');
            expect(topo.cnsId).toBe('myApp:core');
            expect(topo.neurons[0].id).toBe('myApp:core:testNeuron');
            expect(topo.collaterals[0].neuronId).toBe('myApp:core:testNeuron');
        });
    });

    // The legacy id-based stimulation lifecycle (stimulation.started/hop/completed)
    // was removed in Phase 2b-4. Name-based emit is covered by durable-model.test.ts
    // (real CNS + persistor). Topology + safeValue below remain valid.

    describe('safeValue', () => {
        it('handles circular structures', () => {
            const dt = new CNSDevTools('app', new CaptureBatchTransport());
            const obj: any = { a: 1 };
            obj.self = obj;
            const result = (dt as any).safeValue(obj);
            expect(result).toEqual({ a: 1, self: '[Circular]' });
        });

        it('serializes errors to plain objects', () => {
            const dt = new CNSDevTools('app', new CaptureBatchTransport());
            const err = new Error('boom');
            const result = (dt as any).safeValue(err) as any;
            expect(result.message).toBe('boom');
            expect(result.name).toBe('Error');
        });

        it('handles null and undefined', () => {
            const dt = new CNSDevTools('app', new CaptureBatchTransport());
            expect((dt as any).safeValue(null)).toBeNull();
            expect((dt as any).safeValue(undefined)).toBeNull();
        });
    });
});
