/**
 * Redis-backed resume-progress store (`ICNSProgressRepository`) — broker-agnostic.
 *
 * Stores one key per run/job (`<prefix>:<key>` → the serialized `TCNSProgress`
 * frontier). Use it with ANY broker: pg-boss (pass it to `resume.repository`),
 * BullMQ (instead of the native job-progress default), or a bespoke worker. One
 * value per key; delete when the run/job settles. A job that fails PERMANENTLY
 * never reaches that delete, so set `ttlMs` if you want those keys to expire on
 * their own — nothing expires by default.
 *
 * Inject an existing ioredis connection (share the one BullMQ/pg-boss already use)
 * or pass connection options for the repo to own one.
 */
import IORedis from 'ioredis';
import type { Redis, RedisOptions } from 'ioredis';
import type { ICNSProgressRepository } from '@cnstra/persist';
import type { TCNSProgress } from '@cnstra/persist-dto';

export type TCNSRedisProgressRepositoryOptions = {
    /** An existing ioredis client (not closed by `close()`). */
    redis?: Redis;
    /** Or ioredis connection options for the repo to own a client. */
    connection?: RedisOptions;
    /** Key prefix (default `cns:progress`). Final key is `<prefix>:<key>`. */
    prefix?: string;
    /**
     * OPTIONAL expiry applied to every saved key, in milliseconds. **Off unless
     * you set it** — a store that silently forgets a checkpoint nobody asked it to
     * forget is worse than one that grows, so nothing here expires by default.
     *
     * Set it as the safety net for jobs that fail PERMANENTLY (retries exhausted):
     * nothing calls `delete` on that path — there is no terminal-failure hook — so
     * the frontier key would otherwise live forever. Every `save` re-sets the
     * expiry, so a run that is still making progress or still retrying keeps its
     * key alive; choose a value comfortably larger than your longest retry backoff
     * window. This is the Redis-native counterpart of `deleteStale` on the pg-boss
     * progress store, and needs no scheduled sweep.
     *
     * Ignored unless positive and finite.
     */
    ttlMs?: number;
};

export class CNSRedisProgressRepository implements ICNSProgressRepository {
    private readonly redis: Redis;
    private readonly ownsRedis: boolean;
    private readonly prefix: string;
    /** Resolved `ttlMs`; `undefined` = no expiry (the default). */
    private readonly ttlMs: number | undefined;

    constructor(opts: TCNSRedisProgressRepositoryOptions = {}) {
        if (opts.redis) {
            this.redis = opts.redis;
            this.ownsRedis = false;
        } else {
            this.redis = new IORedis({
                ...opts.connection,
                maxRetriesPerRequest: opts.connection?.maxRetriesPerRequest ?? null,
            });
            this.ownsRedis = true;
        }
        this.prefix = opts.prefix ?? 'cns:progress';
        this.ttlMs =
            typeof opts.ttlMs === 'number' &&
            Number.isFinite(opts.ttlMs) &&
            opts.ttlMs > 0
                ? Math.floor(opts.ttlMs)
                : undefined;
    }

    private k(key: string): string {
        return `${this.prefix}:${key}`;
    }

    /**
     * Upsert the frontier. With `ttlMs` configured this is a `SET … PX <ttl>`, so
     * each save slides the expiry forward; without it, a plain `SET` that never
     * expires (see `ttlMs`).
     */
    async save(key: string, progress: TCNSProgress): Promise<void> {
        const value = JSON.stringify(progress);
        if (this.ttlMs === undefined) {
            await this.redis.set(this.k(key), value);
        } else {
            await this.redis.set(this.k(key), value, 'PX', this.ttlMs);
        }
    }

    async load(key: string): Promise<TCNSProgress | undefined> {
        const raw = await this.redis.get(this.k(key));
        return raw ? (JSON.parse(raw) as TCNSProgress) : undefined;
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(this.k(key));
    }

    /** Close the owned client (no-op when a client was injected). */
    async close(): Promise<void> {
        if (this.ownsRedis) await this.redis.quit();
    }
}
