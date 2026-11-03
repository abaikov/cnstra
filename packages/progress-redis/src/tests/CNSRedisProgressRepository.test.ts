import { CNSRedisProgressRepository } from '.././CNSRedisProgressRepository';
import type { TCNSProgress } from '@cnstra/persist-dto';

// Map-backed ioredis stand-in (only the methods the repo uses).
function fakeRedis() {
    const store = new Map<string, string>();
    /** Every `SET` as issued, so a test can assert on its expiry arguments. */
    const setCalls: unknown[][] = [];
    return {
        store,
        setCalls,
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string, ...rest: unknown[]) => {
            setCalls.push([k, v, ...rest]);
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

test('save sets no expiry by default — the checkpoint outlives every retry', async () => {
    const redis = fakeRedis();
    const repo = new CNSRedisProgressRepository({ redis: redis as never });

    await repo.save('job-1', progress);
    expect(redis.setCalls).toEqual([
        ['cns:progress:job-1', JSON.stringify(progress)],
    ]); // no PX/EX token
});

test('save sets a PX expiry when ttlMs is configured', async () => {
    const redis = fakeRedis();
    const repo = new CNSRedisProgressRepository({
        redis: redis as never,
        ttlMs: 60_000,
    });

    await repo.save('job-1', progress);
    // A permanently failed job never reaches `delete`; the TTL is what stops its
    // frontier key living forever.
    expect(redis.setCalls).toEqual([
        ['cns:progress:job-1', JSON.stringify(progress), 'PX', 60_000],
    ]);

    // Still a plain read/write store — the expiry does not change the round-trip.
    expect(await repo.load('job-1')).toEqual(progress);
});

test('a non-positive ttlMs is ignored rather than expiring the key instantly', async () => {
    const redis = fakeRedis();
    const repo = new CNSRedisProgressRepository({
        redis: redis as never,
        ttlMs: 0,
    });

    await repo.save('job-1', progress);
    expect(redis.setCalls[0]).toEqual([
        'cns:progress:job-1',
        JSON.stringify(progress),
    ]);
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
