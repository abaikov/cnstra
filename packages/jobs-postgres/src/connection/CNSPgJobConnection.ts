import type { ICNSPgJobClient } from '../interfaces/ICNSPgJobClient';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSPgJobConnection {
    static from(client: ICNSPgJobClient): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const result = await client.query(text, [...params]);
                return { rows: result.rows as TRow[], rowCount: result.rowCount ?? 0 };
            },
        };
    }
}
