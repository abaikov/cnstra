import type { ICNSJobStateRepository, TCNSJobRunContext } from '@cnstra/jobs';
import type { ICNSProgressRepository } from '@cnstra/persist';
import type { TCNSProgress } from '@cnstra/persist-dto';

export class CNSJobProgressRepository implements ICNSProgressRepository {
    constructor(
        private readonly context: TCNSJobRunContext,
        private readonly stateRepository: ICNSJobStateRepository,
        private readonly onError: (error: unknown) => void
    ) {}

    async save(_key: string, progress: TCNSProgress): Promise<void> {
        try {
            await this.context.saveState(progress);
        } catch (error) {
            this.onError(error);
        }
    }

    async load(): Promise<TCNSProgress | undefined> {
        return (await this.stateRepository.load(this.context.jobState.jobId)) as TCNSProgress | undefined;
    }

    async delete(): Promise<void> {}
}
