import { CNSPgBossProgressRepository } from './CNSPgBossProgressRepository';
import { assertSafeTable } from './migrate';
import type { TCNSProgress } from '@cnstra/persist-dto';

// Map-backed pg Pool stand-in that interprets the repo's SQL by leading verb.
function fakePool() {
    const rows = new Map<string, unknown>();
    const verbs: string[] = [];
    return {
        rows,
        verbs,
        async query(text: string, params?: unknown[]) {
            const verb = text.trim().split(/\s+/)[0].toUpperCase();
            verbs.push(verb);
            if (verb === 'INSERT') {
                rows.set(String(params![0]), JSON.parse(String(params![1])));
            } else if (verb === 'SELECT') {
                const p = rows.get(String(params![0]));
                return { rows: p === undefined ? [] : [{ progress: p }] };
            } else if (verb === 'DELETE') {
                rows.delete(String(params![0]));
            }
            return { rows: [] };
        },
        async end() {},
    };
}

const progress: TCNSProgress = {
    tasks: [{ neuronName: 'n2', dendriteCollateralName: 'step1Out' }],
    context: { n2: { attempt: 1 } },
};

test('save → load → delete round-trips, auto-migrates once', async () => {
    const pool = fakePool();
    const repo = new CNSPgBossProgressRepository({ pool: pool as never });

    expect(await repo.load('job-1')).toBeUndefined();
    await repo.save('job-1', progress);
    expect(await repo.load('job-1')).toEqual(progress);
    await repo.delete('job-1');
    expect(await repo.load('job-1')).toBeUndefined();

    // CREATE TABLE ran exactly once (lazy ensure, memoised).
    expect(pool.verbs.filter(v => v === 'CREATE')).toHaveLength(1);
});

test('autoMigrate:false skips the CREATE TABLE', async () => {
    const pool = fakePool();
    const repo = new CNSPgBossProgressRepository({
        pool: pool as never,
        autoMigrate: false,
    });
    await repo.save('job-1', progress);
    expect(pool.verbs).not.toContain('CREATE');
});

test('rejects an unsafe table name', () => {
    expect(() => assertSafeTable('bad; drop table x')).toThrow();
    expect(() =>
        new CNSPgBossProgressRepository({
            pool: fakePool() as never,
            table: 'bad-name',
        })
    ).toThrow();
});
