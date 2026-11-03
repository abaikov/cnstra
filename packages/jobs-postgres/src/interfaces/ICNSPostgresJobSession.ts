import type { ICNSPostgresJobConnection } from './ICNSPostgresJobConnection';

export interface ICNSPostgresJobSession extends ICNSPostgresJobConnection {
    onLost(handler: (error: unknown) => void): void;
    release(): Promise<void>;
}
