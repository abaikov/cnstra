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

function rowToStimulation(r: any): CNSDTOStimulation {
    return {
        id: r.id,
        cnsId: r.cns_id,
        appId: r.app_id,
        collateralId: r.collateral_id,
        payload: r.payload,
        startedAt: Number(r.started_at),
        completedAt: r.completed_at == null ? null : Number(r.completed_at),
        hopCount: Number(r.hop_count),
        hasError: Boolean(r.has_error),
        replayOf: r.replay_of ?? null,
    };
}

function rowToHop(r: any): CNSDTOHop {
    return {
        id: r.id,
        stimulationId: r.stimulation_id,
        index: Number(r.index),
        neuronId: r.neuron_id,
        inputCollateralId: r.input_collateral_id,
        outputCollateralId: r.output_collateral_id ?? null,
        inputPayload: r.input_payload,
        outputPayload: r.output_payload ?? null,
        startedAt: Number(r.started_at),
        duration: r.duration == null ? null : Number(r.duration),
        error: r.error ?? null,
    };
}

/**
 * PostgreSQL-backed repository for the CNStra DevTools server. Durable
 * counterpart of `@cnstra/devtools-server-repository-in-memory`: same
 * `ICNSDevToolsServerRepository` contract, but stimulations/hops survive
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
            create table if not exists ${p}stimulation (
                id text primary key,
                cns_id text not null,
                app_id text not null,
                collateral_id text not null,
                payload jsonb,
                started_at bigint not null,
                completed_at bigint,
                hop_count integer not null default 0,
                has_error boolean not null default false,
                replay_of text
            );
            create index if not exists ${p}stimulation_app_started
                on ${p}stimulation (app_id, started_at desc);
            create table if not exists ${p}hop (
                id text primary key,
                stimulation_id text not null,
                "index" integer not null,
                neuron_id text not null,
                input_collateral_id text not null,
                output_collateral_id text,
                input_payload jsonb,
                output_payload jsonb,
                started_at bigint not null,
                duration integer,
                error text
            );
            create index if not exists ${p}hop_stim on ${p}hop (stimulation_id, "index");
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

    // ─── Stimulations ───────────────────────────────────────────────────────

    async saveStimulation(s: CNSDTOStimulation): Promise<void> {
        await this.db.query(
            `insert into ${this.p}stimulation
                (id, cns_id, app_id, collateral_id, payload, started_at,
                 completed_at, hop_count, has_error, replay_of)
             values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
             on conflict (id) do update set
                cns_id = excluded.cns_id,
                app_id = excluded.app_id,
                collateral_id = excluded.collateral_id,
                payload = excluded.payload,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                hop_count = excluded.hop_count,
                has_error = excluded.has_error,
                replay_of = excluded.replay_of`,
            [
                s.id,
                s.cnsId,
                s.appId,
                s.collateralId,
                j(s.payload),
                s.startedAt,
                s.completedAt,
                s.hopCount,
                s.hasError,
                s.replayOf,
            ]
        );
    }

    async completeStimulation(
        stimulationId: string,
        completedAt: number,
        hopCount: number,
        hasError: boolean
    ): Promise<void> {
        await this.db.query(
            `update ${this.p}stimulation
                set completed_at = $2, hop_count = $3, has_error = $4
             where id = $1`,
            [stimulationId, completedAt, hopCount, hasError]
        );
    }

    async getStimulations(
        appId: string,
        filter: CNSDTOStimulationFilter
    ): Promise<{ items: CNSDTOStimulation[]; total: number }> {
        const where: string[] = [`app_id = $1`];
        const params: unknown[] = [appId];
        let n = 2;

        if (filter.fromTimestamp !== undefined) {
            where.push(`started_at >= $${n++}`);
            params.push(filter.fromTimestamp);
        }
        if (filter.toTimestamp !== undefined) {
            where.push(`started_at <= $${n++}`);
            params.push(filter.toTimestamp);
        }
        if (filter.hasError !== undefined) {
            where.push(`has_error = $${n++}`);
            params.push(filter.hasError);
        }
        if (filter.collateralId !== undefined) {
            where.push(`collateral_id = $${n++}`);
            params.push(filter.collateralId);
        }
        if (filter.neuronId !== undefined) {
            // Mirror the in-memory `collateralId.startsWith(neuronId)` heuristic.
            where.push(`starts_with(collateral_id, $${n++})`);
            params.push(filter.neuronId);
        }
        const whereSql = where.join(' and ');

        const countRes = await this.db.query(
            `select count(*)::int as total from ${this.p}stimulation where ${whereSql}`,
            params
        );
        const total = Number(countRes.rows[0]?.total ?? 0);

        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;
        const { rows } = await this.db.query(
            `select * from ${this.p}stimulation where ${whereSql}
             order by started_at desc
             limit $${n} offset $${n + 1}`,
            [...params, limit, offset]
        );
        return { items: rows.map(rowToStimulation), total };
    }

    // ─── Hops ───────────────────────────────────────────────────────────────

    async saveHop(hop: CNSDTOHop): Promise<void> {
        await this.db.query(
            `insert into ${this.p}hop
                (id, stimulation_id, "index", neuron_id, input_collateral_id,
                 output_collateral_id, input_payload, output_payload,
                 started_at, duration, error)
             values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
             on conflict (id) do nothing`,
            [
                hop.id,
                hop.stimulationId,
                hop.index,
                hop.neuronId,
                hop.inputCollateralId,
                hop.outputCollateralId,
                j(hop.inputPayload),
                j(hop.outputPayload),
                hop.startedAt,
                hop.duration,
                hop.error,
            ]
        );
    }

    async getHops(stimulationId: string): Promise<CNSDTOHop[]> {
        const { rows } = await this.db.query(
            `select * from ${this.p}hop where stimulation_id = $1 order by "index" asc`,
            [stimulationId]
        );
        return rows.map(rowToHop);
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
