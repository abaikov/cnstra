import {
    onCNSLaunch,
    onCNSResume,
    runCNSDevToolsAction,
} from '.././runCNSDevToolsAction';
import type {
    TCNSDevToolsAction,
    TCNSDevToolsActionMiddleware,
} from '.././TCNSDevToolsAction';

const resume: TCNSDevToolsAction = {
    type: 'resume',
    requestId: 'req-1',
    stimulationId: 'order-42',
    stimulationAttemptId: 'order-42#2',
    attemptNumber: 2,
    entry: { collateralName: 'order.created', payload: null },
    progress: { tasks: [] },
};

const launch: TCNSDevToolsAction = {
    type: 'launch',
    requestId: 'req-1',
    stimulationId: 'order-42-clone-1-a',
    stimulationAttemptId: 'order-42-clone-1-a#1',
    entry: { collateralName: 'order.created', payload: null },
};

/** A link that records it ran and passes the action on. */
const passing = (log: string[], name: string): TCNSDevToolsActionMiddleware =>
    async (_action, next) => {
        log.push(`${name}:enter`);
        await next();
        log.push(`${name}:exit`);
    };

/** A link that claims the action and stops the chain. */
const claiming = (log: string[], name: string): TCNSDevToolsActionMiddleware =>
    async () => {
        log.push(`${name}:handled`);
    };

describe('runCNSDevToolsAction', () => {
    it('reports that nobody carried the action out', async () => {
        // The panel must be told, or the button silently does nothing.
        const log: string[] = [];

        await expect(
            runCNSDevToolsAction([passing(log, 'a'), passing(log, 'b')], resume)
        ).resolves.toBe(false);
        expect(log).toEqual(['a:enter', 'b:enter', 'b:exit', 'a:exit']);
    });

    it('stops at the first link that claims the action', async () => {
        const log: string[] = [];

        await expect(
            runCNSDevToolsAction(
                [passing(log, 'a'), claiming(log, 'bull'), passing(log, 'never')],
                resume
            )
        ).resolves.toBe(true);
        expect(log).toEqual(['a:enter', 'bull:handled', 'a:exit']);
    });

    it('lets a link run AFTER the one that acted — the thing a plain handler chain cannot do', async () => {
        const log: string[] = [];
        const audit: TCNSDevToolsActionMiddleware = async (action, next) => {
            await next();
            log.push(`audited:${action.stimulationId}`);
        };

        await runCNSDevToolsAction([audit, claiming(log, 'bull')], resume);

        expect(log).toEqual(['bull:handled', 'audited:order-42']);
    });

    it('lets a link refuse the action outright by not passing it on', async () => {
        const log: string[] = [];
        const forbid: TCNSDevToolsActionMiddleware = async () => {
            log.push('refused');
        };

        await expect(
            runCNSDevToolsAction([forbid, claiming(log, 'bull')], resume)
        ).resolves.toBe(true);
        expect(log).toEqual(['refused']);
    });

    it('lets a link rewrite the action before the next one sees it', async () => {
        let seen: string | undefined;
        const retarget: TCNSDevToolsActionMiddleware = (action, next) => {
            (action as { scopeName?: string }).scopeName = 'other-graph';
            return next();
        };
        const sink: TCNSDevToolsActionMiddleware = async action => {
            seen = action.scopeName;
        };

        await runCNSDevToolsAction([retarget, sink], { ...resume });

        expect(seen).toBe('other-graph');
    });

    it('propagates a failure instead of pretending the action succeeded', async () => {
        const boom: TCNSDevToolsActionMiddleware = async () => {
            throw new Error('queue is down');
        };

        await expect(runCNSDevToolsAction([boom], resume)).rejects.toThrow(
            'queue is down'
        );
    });

    it('rejects a link that calls next() twice', async () => {
        // Twice is a programming error, not a retry — running the rest of the
        // chain again would re-execute whatever already acted.
        const twice: TCNSDevToolsActionMiddleware = async (_a, next) => {
            await next();
            await next();
        };

        await expect(
            runCNSDevToolsAction([twice, claiming([], 'bull')], resume)
        ).rejects.toThrow(/next\(\) twice/);
    });

    it('runs nothing and reports false for an empty chain', async () => {
        await expect(runCNSDevToolsAction([], resume)).resolves.toBe(false);
    });
});

describe('typed authoring helpers', () => {
    it('onCNSResume only sees Retry, and passes a launch straight through', async () => {
        const seen: string[] = [];
        const chain = [
            onCNSResume(async action => {
                seen.push(`resume:${action.attemptNumber}`);
            }),
        ];

        expect(await runCNSDevToolsAction(chain, resume)).toBe(true);
        expect(await runCNSDevToolsAction(chain, launch)).toBe(false);
        expect(seen).toEqual(['resume:2']);
    });

    it('onCNSLaunch only sees Clone/Replay', async () => {
        const seen: string[] = [];
        const chain = [
            onCNSLaunch(async action => {
                seen.push(`launch:${action.stimulationId}`);
            }),
        ];

        expect(await runCNSDevToolsAction(chain, launch)).toBe(true);
        expect(await runCNSDevToolsAction(chain, resume)).toBe(false);
        expect(seen).toEqual(['launch:order-42-clone-1-a']);
    });

    it('a helper can still pass its own action on to the next link', async () => {
        const log: string[] = [];
        const chain = [
            onCNSResume(async (_action, next) => {
                log.push('checked');
                await next();
            }),
            claiming(log, 'bull'),
        ];

        expect(await runCNSDevToolsAction(chain, resume)).toBe(true);
        expect(log).toEqual(['checked', 'bull:handled']);
    });
});
