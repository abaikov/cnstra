import { CNSDevTools } from '../index';
import type { ICNSDevToolsTransport } from '../interfaces/ICNSDevToolsTransport';
import { cnsCollateral, cnsNeuronFactory } from '@cnstra/core';
import { CNSPersistOptionsRegistry } from '@cnstra/persist';
import type { TCNSAppBatchMessageDTO, TCNSAppBatchItemDTO } from '@cnstra/devtools-dto';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function buildRegistry() {
    const userCreated = cnsCollateral<{ userId: string }>();
    const userUpdated = cnsCollateral<{ userId: string }>();
    const emailSent = cnsCollateral<{ to: string }>();
    const userLogin = cnsCollateral<{ email: string }>();

    const userNeuron = cnsNeuronFactory()
        .neuron({ userCreated, userUpdated })
        .bind({}, {});

    const emailNeuron = cnsNeuronFactory()
        .neuron({ emailSent })
        .bind({ userCreated }, { userCreated: (_, axon) => axon.emailSent.createSignal({ to: 'test@test.com' }) });

    const registry = new CNSPersistOptionsRegistry();
    registry
        .register('user-service', userNeuron, {
            userCreated: 'user-created',
            userUpdated: 'user-updated',
        })
        .register('email-service', emailNeuron, { emailSent: 'email-sent' })
        .registerCollateral('user-login', userLogin);

    return { registry, userNeuron, emailNeuron, userCreated, userUpdated, emailSent, userLogin };
}

class MockCNS {
    private listeners: Array<(r: any) => void> = [];
    network = { getParentNeuronByCollateral: () => null };

    addResponseListener(fn: (r: any) => void) {
        this.listeners.push(fn);
        return () => {};
    }

    stimulate() { return { waitUntilComplete: () => new Promise<void>(() => {}) }; }

    trigger(response: any) { this.listeners.forEach(fn => fn(response)); }
}

class BatchCapture implements ICNSDevToolsTransport {
    batches: TCNSAppBatchMessageDTO[] = [];
    async sendBatch(m: TCNSAppBatchMessageDTO) { this.batches.push(m); }
    allItems(): TCNSAppBatchItemDTO[] { return this.batches.flatMap(b => b.items); }
    itemsOf<T extends TCNSAppBatchItemDTO['type']>(type: T): Extract<TCNSAppBatchItemDTO, { type: T }>[] {
        return this.allItems().filter((i): i is Extract<TCNSAppBatchItemDTO, { type: T }> => i.type === type);
    }
}

function makeStim() {
    let resolve!: () => void, reject!: (e: any) => void;
    const p = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { waitUntilComplete: () => p, resolve, reject };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Protocol — topology', () => {
    it('sends one topology item on registerCNS', async () => {
        const { registry } = buildRegistry();
        const transport = new BatchCapture();
        new CNSDevTools('app', transport).registerCNS(new MockCNS() as any, registry);
        await new Promise(r => setTimeout(r, 0));

        const topos = transport.itemsOf('topology');
        expect(topos).toHaveLength(1);
    });

    it('topology contains all neurons, collaterals, dendrites', async () => {
        const { registry } = buildRegistry();
        const transport = new BatchCapture();
        new CNSDevTools('app', transport).registerCNS(new MockCNS() as any, registry);
        await new Promise(r => setTimeout(r, 0));

        const [topo] = transport.itemsOf('topology');
        expect(topo.neurons.map(n => n.name).sort()).toEqual(['email-service', 'user-service']);
        expect(topo.collaterals.map(c => c.name).sort()).toEqual(['email-sent', 'user-created', 'user-updated']);
        expect(topo.dendrites).toHaveLength(1); // email-service listens to userCreated
    });

    it('uses cnsId from options', async () => {
        const { registry } = buildRegistry();
        const transport = new BatchCapture();
        new CNSDevTools('app', transport, { cnsId: 'app:main' })
            .registerCNS(new MockCNS() as any, registry);
        await new Promise(r => setTimeout(r, 0));

        expect(transport.itemsOf('topology')[0].cnsId).toBe('app:main');
    });

    it('neurons are identified by name + cnsId (no derived id)', async () => {
        const { registry } = buildRegistry();
        const transport = new BatchCapture();
        new CNSDevTools('app', transport, { cnsId: 'app:core' })
            .registerCNS(new MockCNS() as any, registry);
        await new Promise(r => setTimeout(r, 0));

        const [topo] = transport.itemsOf('topology');
        const neuron = topo.neurons.find(n => n.name === 'user-service')!;
        expect(neuron.cnsId).toBe('app:core');
        expect((neuron as Record<string, unknown>).id).toBeUndefined();
    });

    it('collateral carries its owner neuron by name', async () => {
        const { registry } = buildRegistry();
        const transport = new BatchCapture();
        new CNSDevTools('app', transport, { cnsId: 'app:core' })
            .registerCNS(new MockCNS() as any, registry);
        await new Promise(r => setTimeout(r, 0));

        const [topo] = transport.itemsOf('topology');
        const col = topo.collaterals.find(c => c.name === 'user-created')!;
        expect(col.ownerNeuronName).toBe('user-service');
    });
});

// The legacy id-based stimulation lifecycle (stimulation.started/hop/completed)
// was removed in Phase 2b-4; the name-based emit (cns.stimulation/.attempt/.task)
// is covered end-to-end by resumable-model.test.ts and resumable-retry.test.ts against
// a REAL CNS + persistor (the synthetic MockCNS here can't drive the persistor's
// neuron/queueLength invariants). Topology + safeValue below remain valid.

describe('Protocol — safe value serialization', () => {
    it('handles circular structures', () => {
        const dt = new CNSDevTools('app', new BatchCapture());
        const obj: any = { a: 1 };
        obj.self = obj;
        expect((dt as any).safeValue(obj)).toEqual({ a: 1, self: '[Circular]' });
    });

    it('serializes errors to plain objects', () => {
        const dt = new CNSDevTools('app', new BatchCapture());
        const result = (dt as any).safeValue(new Error('boom')) as any;
        expect(result.message).toBe('boom');
        expect(result.name).toBe('Error');
    });

    it('handles null and undefined as null', () => {
        const dt = new CNSDevTools('app', new BatchCapture());
        expect((dt as any).safeValue(null)).toBeNull();
        expect((dt as any).safeValue(undefined)).toBeNull();
    });

    it('handles primitives as-is', () => {
        const dt = new CNSDevTools('app', new BatchCapture());
        expect((dt as any).safeValue(42)).toBe(42);
        expect((dt as any).safeValue('hello')).toBe('hello');
        expect((dt as any).safeValue(true)).toBe(true);
    });
});
