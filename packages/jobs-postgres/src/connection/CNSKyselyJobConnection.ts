import type { ICNSKyselyJobTransaction } from '../interfaces/ICNSKyselyJobTransaction';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSKyselyJobConnection {
    static from(transaction: ICNSKyselyJobTransaction): ICNSPostgresJobTransaction {
        const executor = transaction.withoutPlugins();
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const result = await executor.executeQuery({
                    query: { kind: 'RawNode', sqlFragments: [text], parameters: [] },
                    sql: text,
                    parameters: params,
                    queryId: { queryId: globalThis.crypto.randomUUID() },
                });
                const rows = result.rows as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
