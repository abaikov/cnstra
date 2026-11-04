import { createCNSDemoTransport } from '../demoTransport';

const parse = (frames: string[]) => frames.map(frame => JSON.parse(frame));

describe('demo transport', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('opens on the demo app in the page and answers frames the panel sent before it opened', async () => {
        const frames: string[] = [];
        const errors: string[] = [];
        let opened = 0;
        const transport = createCNSDemoTransport({
            onOpen: () => opened++,
            onClose: () => undefined,
            onError: error => errors.push(error.message),
            onMessage: frame => frames.push(frame),
        });

        expect(transport.send(JSON.stringify({ type: 'client.connect' }))).toBe(true);
        expect(transport.send(JSON.stringify({ type: 'sync.request', requestId: 'early', mediaType: 'application/vnd.cnstra.transduction-query.v1+json', encodedRequests: 'apps=~' }))).toBe(true);
        expect(opened).toBe(0);
        for (let turn = 0; turn < 50 && !parse(frames).some(frame => frame.requestId === 'early'); turn++) {
            await jest.advanceTimersByTimeAsync(10);
        }

        expect(errors).toEqual([]);
        expect(opened).toBe(1);
        const answer = parse(frames).find(frame => frame.type === 'sync.response' && frame.requestId === 'early');
        expect(answer.status).toBe(200);
        expect(JSON.parse(answer.body)[0][1].apps.map((app: { id: string }) => app.id)).toEqual(['demo-shop']);

        transport.dispose();
        expect(transport.send(JSON.stringify({ type: 'client.connect' }))).toBe(false);
    });
});
