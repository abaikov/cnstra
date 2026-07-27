import { CNSRedisProgressRepository } from './CNSRedisProgressRepository';
import type { TCNSProgress } from '@cnstra/persist-dto';

// Map-backed ioredis stand-in (only the methods the repo uses).
function fakeRedis() {
    const store = new Map<string, string>();
    return {
        store,
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => {
            store.set(k, v);
            return 'OK';
        },
        del: async (k: string) => {
            const had = store.delete(k);
            return had ? 1 : 0;
        },
        quit: async () => 'OK',
    };
}

const progress: TCNSProgress = {
    tasks: [{ neuronName: 'n2', dendriteCollateralName: 'step1Out' }],
    context: { n2: { attempt: 1 } },
};

test('save → load round-trips the progress under the prefixed key', async () => {
    const redis = fakeRedis();
    const repo = new CNSRedisProgressRepository({
        redis: redis as never,
        prefix: 'p',
    });

    expect(await repo.load('job-1')).toBeUndefined();
    await repo.save('job-1', progress);
    expect([...redis.store.keys()]).toEqual(['p:job-1']); // prefixed
    expect(await repo.load('job-1')).toEqual(progress);

    await repo.delete('job-1');
    expect(await repo.load('job-1')).toBeUndefined();
});

test('does not close an injected client', async () => {
    const redis = fakeRedis();
    let quit = 0;
    redis.quit = async () => {
        quit++;
        return 'OK';
    };
    const repo = new CNSRedisProgressRepository({ redis: redis as never });
    await repo.close();
    expect(quit).toBe(0); // injected → not owned → not closed
});
