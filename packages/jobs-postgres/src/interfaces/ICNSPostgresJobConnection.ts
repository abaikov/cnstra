import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export interface ICNSPostgresJobConnection {
    query<TRow = Record<string, unknown>>(text: string, params?: readonly TCNSPostgresJobParameter[]): Promise<TCNSPostgresJobQueryResult<TRow>>;
}
