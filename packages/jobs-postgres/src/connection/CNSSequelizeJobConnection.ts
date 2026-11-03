import type { ICNSPostgresJobTransaction } from '../interfaces/ICNSPostgresJobTransaction';
import type { ICNSSequelizeJobInstance } from '../interfaces/ICNSSequelizeJobInstance';
import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';
import type { TCNSPostgresJobQueryResult } from '../types/TCNSPostgresJobQueryResult';

export class CNSSequelizeJobConnection {
    static from<TTransaction>(sequelize: ICNSSequelizeJobInstance<TTransaction>, transaction: TTransaction): ICNSPostgresJobTransaction {
        return {
            cnsJobTransaction: true,
            query: async <TRow>(text: string, params: readonly TCNSPostgresJobParameter[] = []): Promise<TCNSPostgresJobQueryResult<TRow>> => {
                const result = await sequelize.query(text, { bind: [...params], transaction });
                const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : []) as TRow[];
                return { rows, rowCount: rows.length };
            },
        };
    }
}
