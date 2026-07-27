import type {
    ICNSDevToolsServerRepository,
    CNSDTOTopologySnapshot,
} from '@cnstra/devtools-server';
import type { CNSDTOApp } from '@cnstra/devtools-dto';

/**
 * Minimal structural view of a `pg` Pool/Client, so this package doesn't hard
 * depend on `pg` or its types. A real `pg.Pool` / `pg.Client` satisfies it.
 */
export interface IPgQueryable {
    query(
        text: string,
        params?: readonly unknown[]
    ): Promise<{ rows: any[] }>;
}

export interface CNSDevToolsServerRepositoryPostgresOptions {
    /** Table name prefix (default "cns_"). */
    tablePrefix?: string;
}

/** JSON-encode a value for a `jsonb` parameter (null-safe). */
const j = (v: unknown): string => JSON.stringify(v ?? null);

function rowToApp(r: any): CNSDTOApp {
    return {
        id: r.id,
        name: r.name,
        version: r.version,
        connectedAt: Number(r.connected_at),
        lastSeenAt: Number(r.last_seen_at),
    };
}

/**
 * PostgreSQL-backed repository for the CNStra DevTools server. Durable
 * counterpart of `@cnstra/devtools-server-repository-in-memory`: same
 * `ICNSDevToolsServerRepository` contract, but topology/app data survives
 * restarts and can back an admin/history panel.
 *
 * Pass an existing `pg` Pool (or anything with `.query`); call `init()` once at
 * startup to create the tables.
 */
export class CNSDevToolsServerRepositoryPostgres
    implements ICNSDevToolsServerRepository
{
    private readonly p: string;

    constructor(
        private readonly db: IPgQueryable,
        options: CNSDevToolsServerRepositoryPostgresOptions = {}
    ) {
        this.p = options.tablePrefix ?? 'cns_';
    }

    /** Create tables and indexes if they don't exist. Idempotent. */
    async init(): Promise<void> {
        const p = this.p;
        await this.db.query(`
            create table if not exists ${p}app (
                id text primary key,
                name text not null,
                version text not null,
                connected_at bigint not null,
                last_seen_at bigint not null
            );
            create table if not exists ${p}topology (
                cns_id text primary key,
                app_id text not null,
                snapshot jsonb not null
            );
            create table if not exists ${p}cns_app (
                cns_id text primary key,
                app_id text not null
            );
            create index if not exists ${p}cns_app_by_app on ${p}cns_app (app_id);
        `);
    }

    // ─── Apps ───────────────────────────────────────────────────────────────

    async upsertApp(app: CNSDTOApp): Promise<void> {
        await this.db.query(
            `insert into ${this.p}app (id, name, version, connected_at, last_seen_at)
             values ($1, $2, $3, $4, $5)
             on conflict (id) do update set
                name = excluded.name,
                version = excluded.version,
                connected_at = excluded.connected_at,
                last_seen_at = excluded.last_seen_at`,
            [app.id, app.name, app.version, app.connectedAt, app.lastSeenAt]
        );
    }

    async listApps(): Promise<CNSDTOApp[]> {
        const { rows } = await this.db.query(`select * from ${this.p}app`);
        return rows.map(rowToApp);
    }

    // ─── Topology ───────────────────────────────────────────────────────────

    async saveTopology(snapshot: CNSDTOTopologySnapshot): Promise<void> {
        await this.db.query(
            `insert into ${this.p}topology (cns_id, app_id, snapshot)
             values ($1, $2, $3::jsonb)
             on conflict (cns_id) do update set
                app_id = excluded.app_id,
                snapshot = excluded.snapshot`,
            [snapshot.cnsId, snapshot.appId, j(snapshot)]
        );
    }

    async getTopology(cnsId?: string): Promise<CNSDTOTopologySnapshot[]> {
        const { rows } = cnsId
            ? await this.db.query(
                  `select snapshot from ${this.p}topology where cns_id = $1`,
                  [cnsId]
              )
            : await this.db.query(`select snapshot from ${this.p}topology`);
        return rows.map(r => r.snapshot as CNSDTOTopologySnapshot);
    }

    // ─── CNS ↔ App mapping ──────────────────────────────────────────────────

    async addCnsToApp(appId: string, cnsId: string): Promise<void> {
        await this.db.query(
            `insert into ${this.p}cns_app (cns_id, app_id)
             values ($1, $2)
             on conflict (cns_id) do update set app_id = excluded.app_id`,
            [cnsId, appId]
        );
    }

    async getCnsByApp(appId: string): Promise<string[]> {
        const { rows } = await this.db.query(
            `select cns_id from ${this.p}cns_app where app_id = $1`,
            [appId]
        );
        return rows.map(r => r.cns_id as string);
    }

    async findAppByCns(cnsId: string): Promise<string | undefined> {
        const { rows } = await this.db.query(
            `select app_id from ${this.p}cns_app where cns_id = $1`,
            [cnsId]
        );
        return rows[0]?.app_id as string | undefined;
    }
}
