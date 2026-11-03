import type { ICNSDrizzleJobSql } from '../interfaces/ICNSDrizzleJobSql';
import type { ICNSDrizzleJobTransaction } from '../interfaces/ICNSDrizzleJobTransaction';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSDrizzleJobConnection {
    static from<TChunk>(transaction: ICNSDrizzleJobTransaction<TChunk>, sql: ICNSDrizzleJobSql<TChunk>): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const chunks = text.split(/(\$\d+)/).map(part => (/^\$\d+$/.test(part) ? sql.param(params[Number(part.slice(1)) - 1]) : sql.raw(part)));
                const result = await transaction.execute(sql.join(chunks));
                const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
