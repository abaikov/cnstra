import type { TCNSHomeostatTransductionRequest, TCNSHomeostatTransductionRow } from '@cnstra/sync';
import { ECNSHomeostatCorrectionStatus } from '@cnstra/sync';
import { OIMDB, getOIMBucketMemberSlotEntities } from '@oimdb/core';
import type { TCNSStimulationAttempt, TCNSStimulationRosterRow } from '@cnstra/persist-dto';
import { createDevTools } from '../createDevTools';
import { devToolsTransportAxon } from '../axons/devToolsTransportAxon';
import { explorerUiAxon } from '../axons/explorerUiAxon';
import { CNSExplorerSyncKeys } from '../CNSExplorerSyncKeys';
import { CNSExplorerNavigation } from '../CNSExplorerNavigation';
import { createCNSMemoryExplorerAddress } from '../createCNSMemoryExplorerAddress';
import { createHeldEntitySingle } from '../createHeldEntitySingle';
import type { TCNSExplorerAddressFactory } from '../types/TCNSExplorerAddressFactory';

const row = (stimulationId: string, status: TCNSStimulationRosterRow['status'], hopCount = 1): TCNSStimulationRosterRow => ({
    stimulationId,
    entry: { collateralName: 'orderPlaced', payload: null },
    status,
    startedAt: 1_000,
    completedAt: status === 'running' ? null : 2_000,
    hopCount,
    hasError: status === 'failed',
});

const attempt = (stimulationId: string, status: TCNSStimulationAttempt['status']): TCNSStimulationAttempt => ({
    stimulationAttemptId: `${stimulationId}#1`,
    stimulationId,
    attemptNumber: 1,
    status,
    startedAt: 1_000,
    completedAt: status === 'running' ? null : 2_000,
    hopCount: 1,
    hasError: false,
    replayOf: null,
    entry: [{ collateralName: 'orderPlaced', payload: null }],
});

const createWorld = ({ isReadOnly = false, createExplorerAddress, db }: { isReadOnly?: boolean; createExplorerAddress?: TCNSExplorerAddressFactory; db?: OIMDB } = {}) => {
    const batches: TCNSHomeostatTransductionRequest[][] = [];
    const server: { rows: TCNSStimulationRosterRow[]; detailStatus: Map<string, TCNSStimulationAttempt['status']> } = {
        rows: [row('s1', 'running')],
        detailStatus: new Map<string, TCNSStimulationAttempt['status']>([['s1', 'running']]),
    };
    window.location.hash = '#/';
    const actionClient = {
        retry: jest.fn(async () => undefined),
        clone: jest.fn(async () => 'c-1'),
        command: jest.fn(async () => undefined),
        launch: jest.fn(async () => 'l-1'),
    };
    const devTools = createDevTools({
        transportKind: 'socket',
        isReadOnly,
        createExplorerAddress,
        db,
        actionClient,
        batchTransduceFn: async requests => {
            batches.push([...requests]);
            return requests.map(({ name, key }): TCNSHomeostatTransductionRow => {
                if (name === 'stimulationPage') return { name, key, data: { rows: server.rows.map(answered => ({ ...answered, entry: { ...answered.entry } })), nextCursor: null, total: server.rows.length } };
                if (name === 'stimulationDetail') {
                    const stimulationId = String(key[0]);
                    return { name, key, data: { attempts: [attempt(stimulationId, server.detailStatus.get(stimulationId) ?? 'completed')], tasks: [] } };
                }
                return { name, key, error: new Error(`not served: ${name}`) };
            });
        },
    });
    devTools.cns.stimulate(devToolsTransportAxon.connectionChanged.createSignal({ status: 'connected' }));
    return { devTools, batches, server, actionClient, readHash: () => window.location.hash };
};

const namesOf = (batch: TCNSHomeostatTransductionRequest[]) => batch.map(request => request.name);

describe('the devtools models', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('asks a page when its bucket is read, fills the bucket with the answered rows, and asks it again after its stale time', async () => {
        const { devTools, batches } = createWorld();
        const key = CNSExplorerSyncKeys.stimulationPage({ tab: 'stimulations' }, {});
        const seen: string[][] = [];
        const dispose = devTools.db.createEffect(() => {
            seen.push(getOIMBucketMemberSlotEntities(devTools.models.stimulationPages.getSlotByKey(key).getBucketMemberSlots()).map(answered => answered.stimulationId));
        });
        devTools.db.flush();

        await jest.advanceTimersByTimeAsync(10);
        expect(batches.map(namesOf)).toEqual([['stimulationPage']]);
        expect(seen[seen.length - 1]).toEqual(['s1']);
        expect(devTools.models.stimulationPageCursors.getSlotByKey(key).entity).toEqual({ total: 1, nextCursor: null });
        expect(devTools.models.stimulationPageHomeostasis.getSlotByKey(key).value.status).toBe(ECNSHomeostatCorrectionStatus.Restored);

        await jest.advanceTimersByTimeAsync(5_000);
        expect(batches.length).toBeGreaterThanOrEqual(2);

        dispose();
        devTools.dispose();
    });

    it('wakes nobody when a polled page answers the same rows again', async () => {
        const { devTools } = createWorld();
        const key = CNSExplorerSyncKeys.stimulationPage({ tab: 'stimulations' }, {});
        let runs = 0;
        const dispose = devTools.db.createEffect(() => {
            for (const slot of devTools.models.stimulationPages.getSlotByKey(key).getBucketMemberSlots()) void slot.entity;
            runs++;
        });
        devTools.db.flush();
        await jest.advanceTimersByTimeAsync(10);
        const runsAfterAnswer = runs;

        await jest.advanceTimersByTimeAsync(5_000);
        expect(runs).toBe(runsAfterAnswer);

        dispose();
        devTools.dispose();
    });

    it('keeps polling the detail of a running run and stops once the run settled', async () => {
        const { devTools, batches, server } = createWorld();
        const dispose = devTools.db.createEffect(() => {
            void devTools.models.stimulationDetails.getSlotByKey(CNSExplorerSyncKeys.stimulationDetail('s1')).entity;
        });
        devTools.db.flush();
        await jest.advanceTimersByTimeAsync(10);
        await jest.advanceTimersByTimeAsync(5_000);
        const whileRunning = batches.length;
        expect(whileRunning).toBeGreaterThanOrEqual(2);

        server.detailStatus.set('s1', 'completed');
        await jest.advanceTimersByTimeAsync(5_000);
        const settledAt = batches.length;
        await jest.advanceTimersByTimeAsync(20_000);
        expect(batches.length).toBe(settledAt);

        dispose();
        devTools.dispose();
    });

    it('asks the detail of a settled run again when its row on a polled page moved', async () => {
        const { devTools, batches, server } = createWorld();
        server.detailStatus.set('s1', 'completed');
        server.rows = [row('s1', 'completed')];
        const key = CNSExplorerSyncKeys.stimulationPage({ tab: 'stimulations' }, {});
        const dispose = devTools.db.createEffect(() => {
            void devTools.models.stimulationPages.getSlotByKey(key).getBucketMemberSlotCount();
            void devTools.models.stimulationDetails.getSlotByKey(CNSExplorerSyncKeys.stimulationDetail('s1')).entity;
        });
        devTools.db.flush();
        await jest.advanceTimersByTimeAsync(10);
        const detailAsks = () => batches.flat().filter(request => request.name === 'stimulationDetail').length;
        expect(detailAsks()).toBe(1);

        server.rows = [row('s1', 'running', 2)];
        await jest.advanceTimersByTimeAsync(5_000);
        expect(detailAsks()).toBe(2);

        dispose();
        devTools.dispose();
    });

    it('keeps the query in the URL: a patch writes the hash and an opened entity pushes onto the trail', async () => {
        const { devTools, readHash } = createWorld();
        devTools.cns.stimulate(explorerUiAxon.queryPatched.createSignal({ patch: { status: 'failed' } }));
        devTools.cns.stimulate(explorerUiAxon.entityOpened.createSignal({ entry: { kind: 'stimulation', id: 's1' }, fresh: true }));
        devTools.cns.stimulate(explorerUiAxon.entityOpened.createSignal({ entry: { kind: 'neuron', id: 'payment' }, fresh: false }));
        expect(CNSExplorerNavigation.queryOfHash(readHash())).toMatchObject({ status: 'failed', selectedNeuron: 'payment', navTrail: ['stimulation:s1', 'neuron:payment'] });

        devTools.cns.stimulate(explorerUiAxon.navigatedBack.createSignal());
        expect(CNSExplorerNavigation.queryOfHash(readHash())).toMatchObject({ selected: 's1', navTrail: ['stimulation:s1'] });
        devTools.dispose();
    });

    it('keeps each memory address to its own devtools and leaves the page hash alone', async () => {
        const first = createWorld({ createExplorerAddress: createCNSMemoryExplorerAddress });
        const second = createWorld({ createExplorerAddress: createCNSMemoryExplorerAddress });
        window.location.hash = '#/host';

        first.devTools.cns.stimulate(explorerUiAxon.queryPatched.createSignal({ patch: { status: 'failed' } }));
        first.devTools.cns.stimulate(explorerUiAxon.queryPatched.createSignal({ patch: { text: 'order' } }));
        second.devTools.cns.stimulate(explorerUiAxon.entityOpened.createSignal({ entry: { kind: 'neuron', id: 'payment' }, fresh: false }));

        expect(first.devTools.readExplorerQuery()).toMatchObject({ status: 'failed', text: 'order' });
        expect(first.devTools.readExplorerQuery().selectedNeuron).toBeUndefined();
        expect(second.devTools.readExplorerQuery()).toMatchObject({ selectedNeuron: 'payment' });
        expect(second.devTools.readExplorerQuery().status).toBeUndefined();
        expect(window.location.hash).toBe('#/host');
        first.devTools.dispose();
        second.devTools.dispose();
    });

    it('works in a host db it was given and leaves that db usable after dispose', async () => {
        const db = new OIMDB();
        const hostSingle = createHeldEntitySingle(db, { count: 0 });
        const { devTools } = createWorld({ db, createExplorerAddress: createCNSMemoryExplorerAddress });
        expect(devTools.db).toBe(db);

        devTools.dispose();
        const seen: number[] = [];
        const dispose = db.createEffect(() => {
            seen.push(hostSingle.getSingleSlot().entity?.count ?? -1);
        });
        db.flush();
        hostSingle.writeSingleSlotContent({ count: 1 });
        db.flush();

        expect(seen[seen.length - 1]).toBe(1);
        dispose();
        db.dispose();
    });

    it('opens on the default window the server sends unless the URL already has a range', async () => {
        const { devTools, readHash } = createWorld();
        devTools.cns.stimulate(devToolsTransportAxon.uiConfigReceived.createSignal({ uiConfig: { defaultWindowMs: 60_000 } }));
        expect(CNSExplorerNavigation.queryOfHash(readHash()).since).toBe(Date.now() - 60_000);
        devTools.dispose();
    });

    it('asks nothing while the devtools connection is not open, and asks the read keys once it opens', async () => {
        const { devTools, batches } = createWorld();
        devTools.cns.stimulate(devToolsTransportAxon.connectionChanged.createSignal({ status: 'connecting' }));
        const dispose = devTools.db.createEffect(() => {
            void devTools.models.stimulationDetails.getSlotByKey(CNSExplorerSyncKeys.stimulationDetail('s1')).entity;
        });
        devTools.db.flush();
        await jest.advanceTimersByTimeAsync(3_000);
        expect(batches).toEqual([]);

        devTools.cns.stimulate(devToolsTransportAxon.connectionChanged.createSignal({ status: 'connected' }));
        await jest.advanceTimersByTimeAsync(10);
        expect(batches.map(namesOf)).toEqual([['stimulationDetail']]);

        dispose();
        devTools.dispose();
    });

    it('runs a retry once while it is pending, shows its notice, and refuses one the server turned off', async () => {
        const { devTools, actionClient } = createWorld();
        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(0);
        expect(actionClient.retry).toHaveBeenCalledTimes(1);
        expect(devTools.models.actionFeedback.getSingleSlot().entity).toEqual({ pending: null, error: null, notice: 'Retry accepted — resuming this run' });

        await jest.advanceTimersByTimeAsync(6_000);
        expect(devTools.models.actionFeedback.getSingleSlot().entity?.notice).toBeNull();

        devTools.cns.stimulate(devToolsTransportAxon.uiConfigReceived.createSignal({ uiConfig: { actions: { retry: false } } }));
        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(0);
        expect(actionClient.retry).toHaveBeenCalledTimes(1);
        expect(devTools.models.actionFeedback.getSingleSlot().entity?.pending).toBeNull();
        devTools.dispose();
    });

    it('keeps a notice its full window when the same notice was shown just before it', async () => {
        const { devTools } = createWorld();
        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(4_000);
        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(3_000);
        expect(devTools.models.actionFeedback.getSingleSlot().entity?.notice).toBe('Retry accepted — resuming this run');

        await jest.advanceTimersByTimeAsync(3_000);
        expect(devTools.models.actionFeedback.getSingleSlot().entity?.notice).toBeNull();
        devTools.dispose();
    });

    it('lets no retry, clone, launch or command reach the action client in read-only mode', async () => {
        const { devTools, actionClient } = createWorld({ isReadOnly: true });
        expect(devTools.models.connection.getSingleSlot().entity).toMatchObject({ status: 'connected', isReadOnly: true });

        devTools.cns.stimulate(explorerUiAxon.stimulationRetryRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(0);
        devTools.cns.stimulate(explorerUiAxon.stimulationCloneRequested.createSignal({ stimulationId: 's1' }));
        await jest.advanceTimersByTimeAsync(0);
        devTools.cns.stimulate(explorerUiAxon.stimulationLaunchRequested.createSignal({ collateralName: 'orderPlaced', payload: null }));
        await jest.advanceTimersByTimeAsync(0);
        devTools.cns.stimulate(explorerUiAxon.stimulationCommandRequested.createSignal({ stimulationId: 's1', command: { name: 'cancel' } }));
        await jest.advanceTimersByTimeAsync(0);

        expect(actionClient.retry).not.toHaveBeenCalled();
        expect(actionClient.clone).not.toHaveBeenCalled();
        expect(actionClient.launch).not.toHaveBeenCalled();
        expect(actionClient.command).not.toHaveBeenCalled();
        expect(devTools.models.actionFeedback.getSingleSlot().entity?.pending).toBeNull();
        devTools.dispose();
    });
});
