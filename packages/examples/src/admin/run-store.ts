/**
 * Selects the admin's run/attempt/task HISTORY store (domain #2):
 *   ADMIN_STORE=postgres  → durable @cnstra/persist-postgres (survives restart)
 *   (default)             → in-memory (per process)
 */
import { CNSInMemoryStimulationRepository } from '@cnstra/persist';
import type { ICNSStimulationRepository } from '@cnstra/persist';
import { CNSPostgresStimulationRepository } from '@cnstra/persist-postgres';

export function createRunStore(): {
    repository: ICNSStimulationRepository;
    store: string;
    closeStore: () => Promise<void>;
} {
    if (process.env.ADMIN_STORE === 'postgres') {
        const connectionString =
            process.env.DATABASE_URL ??
            'postgres://cnstra:cnstra@localhost:5432/cnstra';
        const repo = new CNSPostgresStimulationRepository({ connectionString });
        return {
            repository: repo,
            store: 'postgres',
            closeStore: () => repo.close(),
        };
    }
    return {
        repository: new CNSInMemoryStimulationRepository(),
        store: 'in-memory',
        closeStore: async () => {},
    };
}
