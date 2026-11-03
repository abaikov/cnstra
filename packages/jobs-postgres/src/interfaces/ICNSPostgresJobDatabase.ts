import type { ICNSPostgresJobConnection } from './ICNSPostgresJobConnection';
import type { ICNSPostgresJobSession } from './ICNSPostgresJobSession';

export interface ICNSPostgresJobDatabase extends ICNSPostgresJobConnection {
    transaction<TResult>(work: (connection: ICNSPostgresJobConnection) => Promise<TResult>): Promise<TResult>;
    session(): Promise<ICNSPostgresJobSession>;
    listen(channels: readonly string[], onNotification: (channel: string, payload: string) => void, onLost: (error: unknown) => void): Promise<() => Promise<void>>;
}
