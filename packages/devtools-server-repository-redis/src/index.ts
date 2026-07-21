import type {
    ICNSDevToolsServerRepository,
    CNSDTOTopologySnapshot,
} from '@cnstra/devtools-server';
import type {
    CNSDTOApp,
    CNSDTOStimulation,
    CNSDTOStimulationFilter,
    CNSDTOHop,
} from '@cnstra/devtools-dto';

/**
 * Minimal structural view of an `ioredis` client — only the commands this
 * repository uses. A real `Redis` instance from `ioredis` satisfies it, so we
 * avoid a hard dependency on `ioredis` and its types.
 *
 * Note: this targets ioredis-style lowercase command methods. `node-redis` v4
 * uses different names (hSet, hGetAll, …) and is not directly compatible.
 */
export interface IRedisLike {
    hset(key: string, field: string, value: string): Promise<unknown>;
    hget(key: string, field: string): Promise<string | null>;
    hgetall(key: string): Promise<Record<string, string>>;
    set(key: string, value: string): Promise<unknown>;
    get(key: string): Promise<string | null>;
    zadd(key: string, score: number, member: string): Promise<unknown>;
    zrevrangebyscore(
        key: string,
        max: number | string,
        min: number | string
    ): Promise<string[]>;
    rpush(key: string, value: string): Promise<unknown>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    sadd(key: string, member: string): Promise<unknown>;
    smembers(key: string): Promise<string[]>;
}

export interface CNSDevToolsServerRepositoryRedisOptions {
    /** Key namespace prefix (default "cns:"). */
    keyPrefix?: string;
}

const parse = <T>(s: string | null): T | null =>
    s == null ? null : (JSON.parse(s) as T);

/**
 * Redis-backed repository for the CNStra DevTools server. Durable counterpart of
 * `@cnstra/devtools-server-repository-in-memory` with the same
 * `ICNSDevToolsServerRepository` contract.
 *
 * Data layout (with the default `cns:` prefix):
 *  - `cns:apps`               hash  appId  → app JSON
 *  - `cns:topology`           hash  cnsId  → snapshot JSON
 *  - `cns:stim:{id}`          string        stimulation JSON
 *  - `cns:stims:{appId}`      zset  score=startedAt, member=stimId (ordering/paging)
 *  - `cns:hops:{stimId}`      list          hop JSON (append order)
 *  - `cns:cnsToApp`           hash  cnsId  → appId
 *  - `cns:appToCns:{appId}`   set           cnsId
 */
export class CNSDevToolsServerRepositoryRedis
    implements ICNSDevToolsServerRepository
{
    private readonly p: string;

    constructor(
        private readonly redis: IRedisLike,
        options: CNSDevToolsServerRepositoryRedisOptions = {}
    ) {
        this.p = options.keyPrefix ?? 'cns:';
    }

    // ─── Apps ───────────────────────────────────────────────────────────────

    async upsertApp(app: CNSDTOApp): Promise<void> {
        await this.redis.hset(`${this.p}apps`, app.id, JSON.stringify(app));
    }

    async listApps(): Promise<CNSDTOApp[]> {
        const all = await this.redis.hgetall(`${this.p}apps`);
        return Object.values(all ?? {}).map(v => JSON.parse(v) as CNSDTOApp);
    }

    // ─── Topology ───────────────────────────────────────────────────────────

    async saveTopology(snapshot: CNSDTOTopologySnapshot): Promise<void> {
        await this.redis.hset(
            `${this.p}topology`,
            snapshot.cnsId,
            JSON.stringify(snapshot)
        );
    }

    async getTopology(cnsId?: string): Promise<CNSDTOTopologySnapshot[]> {
        if (cnsId) {
            const raw = await this.redis.hget(`${this.p}topology`, cnsId);
            const snap = parse<CNSDTOTopologySnapshot>(raw);
            return snap ? [snap] : [];
        }
        const all = await this.redis.hgetall(`${this.p}topology`);
        return Object.values(all ?? {}).map(
            v => JSON.parse(v) as CNSDTOTopologySnapshot
        );
    }

    // ─── Stimulations ───────────────────────────────────────────────────────

    async saveStimulation(s: CNSDTOStimulation): Promise<void> {
        await this.redis.set(`${this.p}stim:${s.id}`, JSON.stringify(s));
        await this.redis.zadd(`${this.p}stims:${s.appId}`, s.startedAt, s.id);
    }

    async completeStimulation(
        stimulationId: string,
        completedAt: number,
        hopCount: number,
        hasError: boolean
    ): Promise<void> {
        const raw = await this.redis.get(`${this.p}stim:${stimulationId}`);
        const s = parse<CNSDTOStimulation>(raw);
        if (!s) return;
        const updated: CNSDTOStimulation = {
            ...s,
            completedAt,
            hopCount,
            hasError,
        };
        await this.redis.set(
            `${this.p}stim:${stimulationId}`,
            JSON.stringify(updated)
        );
    }

    async getStimulations(
        appId: string,
        filter: CNSDTOStimulationFilter
    ): Promise<{ items: CNSDTOStimulation[]; total: number }> {
        const max = filter.toTimestamp ?? '+inf';
        const min = filter.fromTimestamp ?? '-inf';

        // Ids ordered by startedAt desc, already time-range filtered by score.
        const ids = await this.redis.zrevrangebyscore(
            `${this.p}stims:${appId}`,
            max,
            min
        );
        if (ids.length === 0) return { items: [], total: 0 };

        const raws = await Promise.all(
            ids.map(id => this.redis.get(`${this.p}stim:${id}`))
        );
        let items = raws
            .map(r => parse<CNSDTOStimulation>(r))
            .filter((s): s is CNSDTOStimulation => s !== null);

        if (filter.hasError !== undefined)
            items = items.filter(s => s.hasError === filter.hasError);
        if (filter.collateralId !== undefined)
            items = items.filter(s => s.collateralId === filter.collateralId);
        if (filter.neuronId !== undefined)
            items = items.filter(s =>
                s.collateralId.startsWith(filter.neuronId!)
            );

        // zrevrangebyscore already returns desc; re-sort defensively.
        items.sort((a, b) => b.startedAt - a.startedAt);

        const total = items.length;
        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;
        return { items: items.slice(offset, offset + limit), total };
    }

    // ─── Hops ───────────────────────────────────────────────────────────────

    async saveHop(hop: CNSDTOHop): Promise<void> {
        await this.redis.rpush(
            `${this.p}hops:${hop.stimulationId}`,
            JSON.stringify(hop)
        );
    }

    async getHops(stimulationId: string): Promise<CNSDTOHop[]> {
        const raws = await this.redis.lrange(
            `${this.p}hops:${stimulationId}`,
            0,
            -1
        );
        return raws
            .map(r => JSON.parse(r) as CNSDTOHop)
            .sort((a, b) => a.index - b.index);
    }

    // ─── CNS ↔ App mapping ──────────────────────────────────────────────────

    async addCnsToApp(appId: string, cnsId: string): Promise<void> {
        await this.redis.hset(`${this.p}cnsToApp`, cnsId, appId);
        await this.redis.sadd(`${this.p}appToCns:${appId}`, cnsId);
    }

    async getCnsByApp(appId: string): Promise<string[]> {
        return this.redis.smembers(`${this.p}appToCns:${appId}`);
    }

    async findAppByCns(cnsId: string): Promise<string | undefined> {
        const appId = await this.redis.hget(`${this.p}cnsToApp`, cnsId);
        return appId ?? undefined;
    }
}
