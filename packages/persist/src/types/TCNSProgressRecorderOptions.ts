import type { CNSProgressSerializer } from '../CNSProgressSerializer';
import type { ICNSProgressRepository } from '../interfaces/ICNSProgressRepository';
import type { ICNSProgressRecordingStrategy } from '../interfaces/ICNSProgressRecordingStrategy';

export type TCNSProgressRecorderOptions = {
    serializer: CNSProgressSerializer;
    repository: ICNSProgressRepository;
    /** Storage key for this run (e.g. the queue job id). */
    key: string;
    /** When to persist. Defaults to CNSDebouncedProgressRecordingStrategy. */
    strategy?: ICNSProgressRecordingStrategy;
};
