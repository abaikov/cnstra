import type { TCNSClientMessageDTO, TCNSServerMessageDTO } from '@cnstra/devtools-dto';
import { createCNSDevToolsSocket } from '../socket';
import { CNSDevToolsPageConfig } from '../CNSDevToolsPageConfig';
import { socketRequest } from '../socketRequest';
import { CNSFakePollingServer } from './CNSFakePollingServer';

const launchRequestOf = (requestId: string): Extract<TCNSClientMessageDTO, { type: 'stimulation.launch' }> => ({ type: 'stimulation.launch', requestId, entry: { collateralName: 'orderPlaced', payload: {} } });

const newStimulationIdOf = (reply: TCNSServerMessageDTO, resolve: (value: string) => void): void => {
    if (reply.type === 'stimulation.launch.accepted') resolve(reply.newStimulationId);
};

describe('socketRequest over the polling transport', () => {
    let uninstallFetch: () => void = () => undefined;

    beforeEach(() => {
        window.history.replaceState({}, '', '/?transport=polling');
    });

    afterEach(() => {
        uninstallFetch();
        window.history.replaceState({}, '', '/');
    });

    it('resolves with the reply carrying the same requestId', async () => {
        const server = new CNSFakePollingServer();
        uninstallFetch = server.install();
        const socket = createCNSDevToolsSocket(CNSDevToolsPageConfig.read());
        socket.connect({ onStatus: () => undefined, onUiConfig: () => undefined });
        await CNSFakePollingServer.flush();

        const reply = socketRequest<string>(socket, launchRequestOf('req-poll-1'), newStimulationIdOf);
        await CNSFakePollingServer.flush();
        await server.reply(JSON.stringify({ type: 'stimulation.launch.accepted', requestId: 'req-poll-1', newStimulationId: 'stimulation-42' }));

        await expect(reply).resolves.toBe('stimulation-42');
        socket.dispose();
    });

    it('ignores a reply whose requestId does not match and a frame that is not JSON', async () => {
        const server = new CNSFakePollingServer();
        uninstallFetch = server.install();
        const socket = createCNSDevToolsSocket(CNSDevToolsPageConfig.read());
        socket.connect({ onStatus: () => undefined, onUiConfig: () => undefined });
        await CNSFakePollingServer.flush();

        const replies: TCNSServerMessageDTO[] = [];
        const reply = socketRequest<string>(socket, launchRequestOf('req-poll-2'), (message, resolve) => {
            replies.push(message);
            newStimulationIdOf(message, resolve);
        });
        await CNSFakePollingServer.flush();

        await server.reply(JSON.stringify({ type: 'stimulation.launch.accepted', requestId: 'someone-else', newStimulationId: 'stimulation-1' }), 'not json at all');
        expect(replies).toEqual([]);

        await server.reply(JSON.stringify({ type: 'stimulation.launch.accepted', requestId: 'req-poll-2', newStimulationId: 'stimulation-7' }));
        expect(replies).toHaveLength(1);
        await expect(reply).resolves.toBe('stimulation-7');

        socket.dispose();
    });
});
