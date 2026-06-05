import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { CNSPersistOptionsRegistry, collateral, withCtx } from '@cnstra/core';
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

    describe('execution tracking', () => {
        it('sends execution.started + execution.hop on first response', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();
            const stim = makeStimulationMock();

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);
            await new Promise(r => setTimeout(r, 0));
            transport.batches = [];

            cns.trigger({
                stimulation: stim,
                outputSignal: { collateral: null, payload: { x: 1 } },
                inputSignal: undefined,
                error: undefined,
            });

            await new Promise(r => setTimeout(r, 0));

            const started = transport.itemsOfType('execution.started');
            const hops = transport.itemsOfType('execution.hop');
            expect(started).toHaveLength(1);
            expect(hops).toHaveLength(1);
            expect(hops[0].hop.index).toBe(0);
            expect(hops[0].hop.executionId).toBe(started[0].execution.id);
        });

        it('increments hop index for subsequent responses on same stimulation', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();
            const stim = makeStimulationMock();

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);
            await new Promise(r => setTimeout(r, 0));
            transport.batches = [];

            cns.trigger({ stimulation: stim, outputSignal: { collateral: null, payload: {} }, inputSignal: undefined, error: undefined });
            cns.trigger({ stimulation: stim, inputSignal: { collateral: null, payload: {} }, outputSignal: { collateral: null, payload: {} }, error: undefined });
            cns.trigger({ stimulation: stim, inputSignal: { collateral: null, payload: {} }, outputSignal: undefined, error: undefined });

            await new Promise(r => setTimeout(r, 0));

            const hops = transport.itemsOfType('execution.hop');
            expect(hops).toHaveLength(3);
            expect(hops[0].hop.index).toBe(0);
            expect(hops[1].hop.index).toBe(1);
            expect(hops[2].hop.index).toBe(2);
        });

        it('sends execution.completed when stimulation resolves', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();
            const stim = makeStimulationMock();

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);
            cns.trigger({ stimulation: stim, outputSignal: { collateral: null, payload: {} }, inputSignal: undefined, error: undefined });

            stim.resolve();
            await new Promise(r => setTimeout(r, 10));

            const completed = transport.itemsOfType('execution.completed');
            expect(completed).toHaveLength(1);
            expect(completed[0].hasError).toBe(false);
        });

        it('sends execution.completed with hasError=true when stimulation rejects', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();

            let reject!: (e: any) => void;
            const stim = {
                waitUntilComplete: () => new Promise<void>((_, r) => { reject = r; }),
            };

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);
            cns.trigger({ stimulation: stim, outputSignal: { collateral: null, payload: {} }, inputSignal: undefined, error: undefined });

            reject(new Error('fail'));
            await new Promise(r => setTimeout(r, 10));

            const completed = transport.itemsOfType('execution.completed');
            expect(completed[0].hasError).toBe(true);
        });

        it('does not send execution.started again for same stimulation', async () => {
            const { registry } = makeRegistry();
            const cns = new MockCNS();
            const transport = new CaptureBatchTransport();
            const stim = makeStimulationMock();

            new CNSDevTools('app', transport).registerCNS(cns as any, registry);

            cns.trigger({ stimulation: stim, outputSignal: { collateral: null, payload: {} }, inputSignal: undefined, error: undefined });
            cns.trigger({ stimulation: stim, inputSignal: { collateral: null, payload: {} }, outputSignal: { collateral: null, payload: {} }, error: undefined });

            await new Promise(r => setTimeout(r, 0));

            const started = transport.itemsOfType('execution.started');
            expect(started).toHaveLength(1);
        });
    });

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
