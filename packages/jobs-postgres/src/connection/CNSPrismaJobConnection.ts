import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { ICNSPrismaJobTransaction } from '../interfaces/ICNSPrismaJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSPrismaJobConnection {
    static from(transaction: ICNSPrismaJobTransaction): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const rows = (await transaction.$queryRawUnsafe(text, ...params)) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
