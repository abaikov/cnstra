import { CNSPostgresSchemaMigrator, CNSPostgresSchemaPgDatabase } from '@cnstra/postgres-schema';
import type { ICNSPostgresSchemaConnection } from '@cnstra/postgres-schema';
import type {
    ICNSDevToolsServerRepository,
    TCNSTopologySnapshotDTO,
} from '@cnstra/devtools-server';

/**
 * Minimal structural view of a `pg` Pool, so this package doesn't hard depend on
 * `pg` or its types. A real `pg.Pool` satisfies it; `init()` takes one of its clients
 * for the migration transaction.
 */
export interface ICNSDevToolsPgQueryable {
    query(
        text: string,
        params?: readonly unknown[]
    ): Promise<{ rows: any[] }>;
    connect(): Promise<{
        query(text: string, params?: readonly unknown[]): Promise<{ rows: any[] }>;
        release(error?: Error | boolean): void;
    }>;
}

export interface ICNSDevToolsServerRepositoryPostgresOptions {
    /** Table name prefix (default "cns_"). */
    tablePrefix?: string;
}

/** JSON-encode a value for a `jsonb` parameter (null-safe). */
const j = (v: unknown): string => JSON.stringify(v ?? null);

const migrator = new CNSPostgresSchemaMigrator({
    name: 'devtools',
    tables: p => [`${p}topology`],
    steps: [
        {
            step: 1,
            kind: 'expand',
            sql: p => `
CREATE TABLE ${p}topology (
    cns_id text PRIMARY KEY,
    app_id text NOT NULL,
    snapshot jsonb NOT NULL
);
`,
        },
    ],
});

/**
 * PostgreSQL-backed repository for the CNStra DevTools server. Resumable
 * counterpart of `@cnstra/devtools-server-repository-in-memory`: same
 * `ICNSDevToolsServerRepository` contract, but topology data survives
 * restarts and can back an admin/history panel.
 *
 * Pass an existing `pg` Pool; call `init()` once at startup to create
 * or upgrade the tables, or `verify()` where another process owns migrations.
 */
export class CNSDevToolsServerRepositoryPostgres
    implements ICNSDevToolsServerRepository
{
    private readonly p: string;

    constructor(
        private readonly db: ICNSDevToolsPgQueryable,
        options: ICNSDevToolsServerRepositoryPostgresOptions = {}
    ) {
        this.p = migrator.assertTablePrefix(options.tablePrefix ?? 'cns_', 'topology');
    }

    async init(): Promise<void> {
        await migrator.migrate(CNSPostgresSchemaPgDatabase.fromPool(this.db), this.p);
    }

    async verify(): Promise<void> {
        await migrator.verify(this.db as unknown as ICNSPostgresSchemaConnection, this.p);
    }

    // ─── Topology ───────────────────────────────────────────────────────────

    async saveTopology(snapshot: TCNSTopologySnapshotDTO): Promise<void> {
        await this.db.query(
            `insert into ${this.p}topology (cns_id, app_id, snapshot)
             values ($1, $2, $3::jsonb)
             on conflict (cns_id) do update set
                app_id = excluded.app_id,
                snapshot = excluded.snapshot`,
            [snapshot.cnsId, snapshot.appId, j(snapshot)]
        );
    }

    async getTopology(cnsId?: string): Promise<TCNSTopologySnapshotDTO[]> {
        const { rows } = cnsId
            ? await this.db.query(
                  `select snapshot from ${this.p}topology where cns_id = $1`,
                  [cnsId]
              )
            : await this.db.query(`select snapshot from ${this.p}topology`);
        return rows.map(r => r.snapshot as TCNSTopologySnapshotDTO);
    }

    async findAppByCns(cnsId: string): Promise<string | undefined> {
        const { rows } = await this.db.query(
            `select app_id from ${this.p}topology where cns_id = $1`,
            [cnsId]
        );
        return rows[0]?.app_id as string | undefined;
    }
}
