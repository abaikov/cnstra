import { CNSHomeostatTransductionChannel } from '@cnstra/sync';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsPollingTransport } from '../src/pollingTransport';

const seededServer = async () => {
    const stimulationRepository = new CNSInMemoryStimulationRepository();
    await stimulationRepository.saveStimulation({ stimulationId: 's1', entry: { collateralName: 'orderPlaced', payload: null }, status: 'completed', progress: { tasks: [] } });
    return new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), stimulationRepository);
};

describe('sync over the devtools connection', () => {
    it('answers a sync.request frame with a sync.response the channel reads keys from', async () => {
        const server = await seededServer();
        const homeostatTransductionChannel: CNSHomeostatTransductionChannel = new CNSHomeostatTransductionChannel({
            sendRequest: request => {
                const panelSocket = { readyState: 1, send: (frame: string) => homeostatTransductionChannel.receiveResponse(JSON.parse(frame)) };
                void server.handleMessage(panelSocket as never, JSON.stringify({ type: 'sync.request', ...request }));
            },
        });

        const rows = await homeostatTransductionChannel.batchTransduceFn(
            [{ name: 'stimulationSnapshot', key: [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10] }, { name: 'apps', key: [undefined] }],
            new AbortController().signal
        );

        expect(rows).toEqual([
            { name: 'apps', key: [undefined], data: { apps: [] } },
            { name: 'stimulationSnapshot', key: [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10], data: { stimulations: [expect.objectContaining({ stimulationId: 's1' })] } },
        ]);
    });

    it('carries the same frames over the HTTP long poll', async () => {
        const polling = new CNSDevToolsPollingTransport(await seededServer(), { waitMs: 5 });
        const homeostatTransductionChannel = new CNSHomeostatTransductionChannel({
            sendRequest: request => void polling.post('ui-1', JSON.stringify({ type: 'sync.request', ...request })),
        });

        const transduced = homeostatTransductionChannel.batchTransduceFn([{ name: 'apps', key: [undefined] }], new AbortController().signal);
        for (const frame of await polling.poll('ui-1')) homeostatTransductionChannel.receiveResponse(JSON.parse(frame));

        expect(await transduced).toEqual([{ name: 'apps', key: [undefined], data: { apps: [] } }]);
    });
});
