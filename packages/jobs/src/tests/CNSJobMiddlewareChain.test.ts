import { describe, expect, it } from '@jest/globals';
import { CNSJobMiddlewareChain } from '../middleware/CNSJobMiddlewareChain';

type TContext = { trail: string[] };

describe('CNSJobMiddlewareChain', () => {
    it('runs middlewares outermost first around the terminal', async () => {
        const run = CNSJobMiddlewareChain.compose<TContext, string>(
            [
                async (context, next) => {
                    context.trail.push('a:in');
                    const result = await next();
                    context.trail.push('a:out');
                    return `a(${result})`;
                },
                async (context, next) => {
                    context.trail.push('b:in');
                    return `b(${await next()})`;
                },
            ],
            async context => {
                context.trail.push('terminal');
                return 'x';
            }
        );
        const context: TContext = { trail: [] };

        expect(await run(context)).toBe('a(b(x))');
        expect(context.trail).toEqual(['a:in', 'b:in', 'terminal', 'a:out']);
    });

    it('skips the terminal when a middleware does not call next', async () => {
        let reached = false;
        const run = CNSJobMiddlewareChain.compose<TContext, string>([async () => 'short'], async () => {
            reached = true;
            return 'x';
        });

        expect(await run({ trail: [] })).toBe('short');
        expect(reached).toBe(false);
    });

    it('rejects a second call of next', async () => {
        const run = CNSJobMiddlewareChain.compose<TContext, string>(
            [
                async (_, next) => {
                    await next();
                    return next();
                },
            ],
            async () => 'x'
        );

        await expect(run({ trail: [] })).rejects.toThrow('next() twice');
    });

    it('turns a synchronous throw into a rejection', async () => {
        const run = CNSJobMiddlewareChain.compose<TContext, string>([], () => {
            throw new Error('sync');
        });

        await expect(run({ trail: [] })).rejects.toThrow('sync');
    });
});
