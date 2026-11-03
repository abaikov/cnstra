import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { ICNSTypeOrmJobQueryable } from '../interfaces/ICNSTypeOrmJobQueryable';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSTypeOrmJobConnection {
    static from(queryable: ICNSTypeOrmJobQueryable): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const result = await queryable.query(text, [...params]);
                const rows = (Array.isArray(result) ? result : []) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
