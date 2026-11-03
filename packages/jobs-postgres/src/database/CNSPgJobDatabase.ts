import type { Pool } from 'pg';
import { CNSPgJobConnection } from '../connection/CNSPgJobConnection';
import type { ICNSPostgresJobConnection } from '../interfaces/ICNSPostgresJobConnection';
import type { ICNSPostgresJobDatabase } from '../interfaces/ICNSPostgresJobDatabase';
import type { ICNSPostgresJobSession } from '../interfaces/ICNSPostgresJobSession';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSPgJobDatabase implements ICNSPostgresJobDatabase {
    constructor(
        private readonly pool: Pool,
        private readonly directPool: Pool = pool
    ) {}

    async query<TRow = Record<string, unknown>>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> {
        return CNSPgJobConnection.from(this.pool).query<TRow>(text, params);
    }

    async transaction<TResult>(work: (connection: ICNSPostgresJobConnection) => Promise<TResult>): Promise<TResult> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(CNSPgJobConnection.from(client));
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
        } finally {
            client.release();
        }
    }

    async session(): Promise<ICNSPostgresJobSession> {
        const client = await this.directPool.connect();
        let lost: unknown;
        let onLost: (error: unknown) => void = () => undefined;
        client.on('error', error => {
            if (lost !== undefined) return;
            lost = error;
            onLost(error);
        });
        return {
            ...CNSPgJobConnection.from(client),
            onLost: handler => {
                onLost = handler;
            },
            release: async () => {
                client.removeAllListeners('error');
                client.release(true);
            },
        };
    }

    async listen(
        channels: readonly string[],
        onNotification: (channel: string, payload: string) => void,
        onLost: (error: unknown) => void
    ): Promise<() => Promise<void>> {
        const client = await this.directPool.connect();
        let released = false;
        const release = (destroy: boolean) => {
            if (released) return;
            released = true;
            client.removeAllListeners('notification');
            client.removeAllListeners('error');
            client.release(destroy || undefined);
        };
        client.on('notification', message => onNotification(message.channel, message.payload ?? ''));
        client.on('error', error => {
            release(true);
            onLost(error);
        });
        try {
            for (const channel of channels) await client.query(`LISTEN "${channel}"`);
        } catch (error) {
            release(true);
            throw error;
        }
        return async () => {
            if (released) return;
            try {
                await client.query('UNLISTEN *');
                release(false);
            } catch (error) {
                release(true);
                throw error;
            }
        };
    }
}
