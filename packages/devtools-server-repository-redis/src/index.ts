import type {
    ICNSDevToolsServerRepository,
    CNSDTOTopologySnapshot,
} from '@cnstra/devtools-server';
import type { CNSDTOApp } from '@cnstra/devtools-dto';

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
