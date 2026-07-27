/**
 * Redis-backed resume-progress store (`ICNSProgressRepository`) — broker-agnostic.
 *
 * Stores one key per run/job (`<prefix>:<key>` → the serialized `TCNSProgress`
 * frontier). Use it with ANY broker: pg-boss (pass it to `resume.repository`),
 * BullMQ (instead of the native job-progress default), or a bespoke worker. One
 * value per key; delete when the run/job settles.
 *
 * Inject an existing ioredis connection (share the one BullMQ/pg-boss already use)
 * or pass connection options for the repo to own one.
 */
import IORedis from 'ioredis';
import type { Redis, RedisOptions } from 'ioredis';
import type { ICNSProgressRepository } from '@cnstra/persist';
import type { TCNSProgress } from '@cnstra/persist-dto';

export interface TCNSRedisProgressRepositoryOptions {
    /** An existing ioredis client (not closed by `close()`). */
    redis?: Redis;
    /** Or ioredis connection options for the repo to own a client. */
    connection?: RedisOptions;
    /** Key prefix (default `cns:progress`). Final key is `<prefix>:<key>`. */
    prefix?: string;
}

export class CNSRedisProgressRepository implements ICNSProgressRepository {
    private readonly redis: Redis;
    private readonly ownsRedis: boolean;
    private readonly prefix: string;

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
    }

    private k(key: string): string {
        return `${this.prefix}:${key}`;
    }

    async save(key: string, progress: TCNSProgress): Promise<void> {
        await this.redis.set(this.k(key), JSON.stringify(progress));
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
