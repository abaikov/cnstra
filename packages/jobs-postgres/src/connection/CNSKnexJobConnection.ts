import type { ICNSKnexJobTransaction } from '../interfaces/ICNSKnexJobTransaction';
import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';
import { CNSJobQuestionMarkQuery } from './CNSJobQuestionMarkQuery';

export class CNSKnexJobConnection {
    static from(transaction: ICNSKnexJobTransaction): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const converted = CNSJobQuestionMarkQuery.convert(text, params);
                const rows = ((await transaction.raw(converted.text, converted.params)).rows ?? []) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
