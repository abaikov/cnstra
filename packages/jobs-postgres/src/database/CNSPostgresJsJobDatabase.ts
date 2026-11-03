import { CNSPostgresJsJobConnection } from '../connection/CNSPostgresJsJobConnection';
import type { ICNSPostgresJobConnection } from '../interfaces/ICNSPostgresJobConnection';
import type { ICNSPostgresJobDatabase } from '../interfaces/ICNSPostgresJobDatabase';
import type { ICNSPostgresJobSession } from '../interfaces/ICNSPostgresJobSession';
import type { ICNSPostgresJsJobSql } from '../interfaces/ICNSPostgresJsJobSql';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSPostgresJsJobDatabase implements ICNSPostgresJobDatabase {
    constructor(private readonly sql: ICNSPostgresJsJobSql) {}

    query<TRow = Record<string, unknown>>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> {
        return CNSPostgresJsJobConnection.from(this.sql).query<TRow>(text, params);
    }

    async transaction<TResult>(work: (connection: ICNSPostgresJobConnection) => Promise<TResult>): Promise<TResult> {
        let result: TResult | undefined;
        await this.sql.begin(async sql => {
            result = await work(CNSPostgresJsJobConnection.from(sql));
        });
        return result as TResult;
    }

    async session(): Promise<ICNSPostgresJobSession> {
        const reserved = await this.sql.reserve();
        return {
            ...CNSPostgresJsJobConnection.from(reserved),
            onLost: () => undefined,
            release: async () => {
                try {
                    await reserved.unsafe('SELECT pg_advisory_unlock_all()');
                } finally {
                    reserved.release();
                }
            },
        };
    }

    async listen(channels: readonly string[], onNotification: (channel: string, payload: string) => void): Promise<() => Promise<void>> {
        const subscriptions = await Promise.all(channels.map(channel => this.sql.listen(channel, payload => onNotification(channel, payload))));
        return async () => {
            await Promise.all(subscriptions.map(subscription => subscription.unlisten()));
        };
    }
}
