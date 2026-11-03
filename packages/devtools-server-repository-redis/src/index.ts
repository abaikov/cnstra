import type {
    ICNSDevToolsServerRepository,
    TCNSTopologySnapshotDTO,
} from '@cnstra/devtools-server';

/**
 * Minimal structural view of an `ioredis` client — only the commands this
 * repository uses. A real `Redis` instance from `ioredis` satisfies it, so we
 * avoid a hard dependency on `ioredis` and its types.
 *
 * Note: this targets ioredis-style lowercase command methods. `node-redis` v4
 * uses different names (hSet, hGetAll, …) and is not directly compatible.
 */
export interface ICNSRedisLike {
    hset(key: string, field: string, value: string): Promise<unknown>;
    hget(key: string, field: string): Promise<string | null>;
    hgetall(key: string): Promise<Record<string, string>>;
}

export interface ICNSDevToolsServerRepositoryRedisOptions {
    /** Key namespace prefix (default "cns:"). */
    keyPrefix?: string;
}

const parse = <T>(s: string | null): T | null =>
    s == null ? null : (JSON.parse(s) as T);

/**
 * Redis-backed repository for the CNStra DevTools server. Resumable counterpart of
 * `@cnstra/devtools-server-repository-in-memory` with the same
 * `ICNSDevToolsServerRepository` contract.
 *
 * Data layout (with the default `cns:` prefix):
 *  - `cns:topology`           hash  cnsId  → snapshot JSON
 */
export class CNSDevToolsServerRepositoryRedis
    implements ICNSDevToolsServerRepository
{
    private readonly p: string;

    constructor(
        private readonly redis: ICNSRedisLike,
        options: ICNSDevToolsServerRepositoryRedisOptions = {}
    ) {
        this.p = options.keyPrefix ?? 'cns:';
    }

    // ─── Topology ───────────────────────────────────────────────────────────

    async saveTopology(snapshot: TCNSTopologySnapshotDTO): Promise<void> {
        await this.redis.hset(
            `${this.p}topology`,
            snapshot.cnsId,
            JSON.stringify(snapshot)
        );
    }

    async getTopology(cnsId?: string): Promise<TCNSTopologySnapshotDTO[]> {
        if (cnsId) {
            const raw = await this.redis.hget(`${this.p}topology`, cnsId);
            const snap = parse<TCNSTopologySnapshotDTO>(raw);
            return snap ? [snap] : [];
        }
        const all = await this.redis.hgetall(`${this.p}topology`);
        return Object.values(all ?? {}).map(
            v => JSON.parse(v) as TCNSTopologySnapshotDTO
        );
    }

    async findAppByCns(cnsId: string): Promise<string | undefined> {
        const [snapshot] = await this.getTopology(cnsId);
        return snapshot?.appId;
    }
}
