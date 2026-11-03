import { CNSDevToolsServer } from '../src/index';
import { CNSDevToolsServerRepositoryInMemory } from '@cnstra/devtools-server-repository-in-memory';
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type { ICNSScheduledStimulationReader, TCNSScheduledStimulationFilter } from '@cnstra/persist-dto';

const socket = () => {
    const sent: string[] = [];
    return {
        readyState: 1,
        send: (data: string) => sent.push(data),
        reply: (type: string) => sent.map(text => JSON.parse(text)).find(message => message.type === type),
    };
};

describe('scheduled stimulations', () => {
    it('answers a list request from the reader with the filter, cursor and limit it was given', async () => {
        const calls: Array<[TCNSScheduledStimulationFilter, string | null, number]> = [];
        const reader: ICNSScheduledStimulationReader = {
            list: async (filter, cursor, limit) => {
                calls.push([filter, cursor, limit]);
                return {
                    rows: [
                        {
                            stimulationId: 'job-1',
                            entry: { collateralName: 'orderPlaced', payload: { orderId: 1 } },
                            status: 'scheduled',
                            runAfter: 5_000,
                            priority: 0,
                            attemptCount: 0,
                            resumes: false,
                            tasks: [{ neuronName: 'charge', dendriteCollateralName: 'orderPlaced' }],
                        },
                    ],
                    schedules: [{ scheduleId: 'hourly', collateralName: 'orderPlaced', cron: '0 * * * *' }],
                    types: [{ collateralName: 'orderPlaced' }],
                    nextCursor: '5000:1',
                };
            },
        };
        const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), new CNSInMemoryStimulationRepository(), [], {}, reader);
        const ws = socket();

        await server.handleMessage(
            ws as any,
            JSON.stringify({ type: 'cns.scheduled.list', requestId: 'r', filter: { neuronName: 'charge' }, cursor: '1:1', limit: 10 })
        );

        expect(calls).toEqual([[{ neuronName: 'charge' }, '1:1', 10]]);
        expect(ws.reply('cns.scheduled.list.result')).toMatchObject({
            requestId: 'r',
            available: true,
            rows: [{ stimulationId: 'job-1', status: 'scheduled' }],
            schedules: [{ scheduleId: 'hourly' }],
            nextCursor: '5000:1',
        });
    });

    it('says the list is unavailable when the server has no reader', async () => {
        const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory());
        const ws = socket();

        await server.handleMessage(ws as any, JSON.stringify({ type: 'cns.scheduled.list', requestId: 'r' }));

        expect(ws.reply('cns.scheduled.list.result')).toEqual({
            type: 'cns.scheduled.list.result',
            requestId: 'r',
            available: false,
            rows: [],
            schedules: [],
            types: [],
            nextCursor: null,
        });
    });
    it('accepts a command a link carried out, and rejects one nobody took or a link refused', async () => {
        const commands: string[] = [];
        const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), new CNSInMemoryStimulationRepository(), [
            async (action, next) => {
                if (action.type !== 'command' || action.stimulationId === 'not-mine') return next();
                if (action.stimulationId === 'finished') throw new Error('job "finished" has already finished');
                commands.push(`${action.command.name}:${action.stimulationId}`);
            },
        ]);
        const send = async (stimulationId: string, command: object) => {
            const ws = socket();
            await server.handleMessage(ws as any, JSON.stringify({ type: 'stimulation.command', requestId: 'r', stimulationId, command }));
            return ws.reply('stimulation.command.accepted') ?? ws.reply('stimulation.command.rejected');
        };

        expect(await send('job-1', { name: 'prioritize', priority: 3 })).toMatchObject({ type: 'stimulation.command.accepted', stimulationId: 'job-1' });
        expect(await send('not-mine', { name: 'runNow' })).toMatchObject({ type: 'stimulation.command.rejected', reason: 'no runtime accepted the runNow command' });
        expect(await send('finished', { name: 'cancel' })).toMatchObject({ reason: 'job "finished" has already finished' });
        expect(await send('job-1', { name: 'prioritize', priority: 1.5 })).toBeUndefined();
        expect(commands).toEqual(['prioritize:job-1']);
    });
    it('launches an entry through the chain under a fresh stimulation id, and rejects one nobody took', async () => {
        const launched: Array<{ stimulationId: string; collateralName: string; payload: unknown }> = [];
        const server = new CNSDevToolsServer(new CNSDevToolsServerRepositoryInMemory(), new CNSInMemoryStimulationRepository(), [
            async (action, next) => {
                if (action.type !== 'launch' || action.entry.collateralName === 'unknown') return next();
                launched.push({ stimulationId: action.stimulationId, ...action.entry });
            },
        ]);
        const send = async (collateralName: string) => {
            const ws = socket();
            await server.handleMessage(ws as any, JSON.stringify({ type: 'stimulation.launch', requestId: 'r', entry: { collateralName, payload: { orderId: 1 } } }));
            return ws.reply('stimulation.launch.accepted') ?? ws.reply('stimulation.launch.rejected');
        };

        const accepted = await send('orderPlaced');
        const rejected = await send('unknown');

        expect(accepted).toMatchObject({ type: 'stimulation.launch.accepted', requestId: 'r' });
        expect(accepted.newStimulationId).toMatch(/^orderPlaced-/);
        expect(launched).toEqual([{ stimulationId: accepted.newStimulationId, collateralName: 'orderPlaced', payload: { orderId: 1 } }]);
        expect(rejected).toMatchObject({ type: 'stimulation.launch.rejected', reason: 'no runtime accepted the launch' });
    });
});
