import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';

export interface ICNSSequelizeJobInstance<TTransaction> {
    query(sql: string, options: { bind: TCNSPostgresJobParameter[]; transaction: TTransaction }): Promise<unknown>;
}
