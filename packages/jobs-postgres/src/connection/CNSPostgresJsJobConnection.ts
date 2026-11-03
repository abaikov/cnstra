import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { ICNSPostgresJsJobSql } from '../interfaces/ICNSPostgresJsJobSql';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSPostgresJsJobConnection {
    static from(sql: Pick<ICNSPostgresJsJobSql, 'unsafe'>): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const result = await sql.unsafe(text, [...params]);
                const rows = Array.from(result) as TRow[];
                return { rows, rowCount: result.count ?? rows.length };
            },
        };
    }
}
