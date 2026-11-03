import type { ICNSPostgresJobConnection } from './ICNSPostgresJobConnection';

export interface ICNSPostgresJobTransaction extends ICNSPostgresJobConnection {
    readonly cnsJobTransaction: true;
}
