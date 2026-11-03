import type { ICNSMikroOrmJobEntityManager } from '../interfaces/ICNSMikroOrmJobEntityManager';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';
import { CNSJobQuestionMarkQuery } from './CNSJobQuestionMarkQuery';

export class CNSMikroOrmJobConnection {
    static from(entityManager: ICNSMikroOrmJobEntityManager): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const converted = CNSJobQuestionMarkQuery.convert(text, params);
                const result = await entityManager.execute(converted.text, converted.params);
                const rows = (Array.isArray(result) ? result : []) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
