export { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
export { CNSPersistOptionsRegistryFactory } from './CNSPersistOptionsRegistryFactory';

export { CNSProgressSerializer } from './CNSProgressSerializer';
export { CNSInMemoryProgressRepository } from './CNSInMemoryProgressRepository';

export { CNSProgressRecorder } from './CNSProgressRecorder';
export { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';

export { CNSStimulationPersistor } from './CNSStimulationPersistor';
export { CNSInMemoryStimulationRepository } from './CNSInMemoryStimulationRepository';
export { CNSFanOutStimulationWriter } from './CNSFanOutStimulationWriter';
export { CNS_JOB_IDENTITY_CONTEXT_KEY } from './CNS_JOB_IDENTITY_CONTEXT_KEY';
export type { TCNSJobIdentity } from './TCNSJobIdentity';
export {
    withCNSWriteChain,
    retryCNSWrites,
    redactCNSPayload,
    capCNSPayload,
} from './writerChain';
export type {
    TCNSStimulationWrite,
    TCNSStimulationWriteMiddleware,
    TCNSRetryWritesOptions,
} from './writerChain';
export type { TCNSInMemoryStimulationRepositoryOptions } from './CNSInMemoryStimulationRepository';

export type { ICNSStimulationRosterQuery } from './interfaces/ICNSStimulationRosterQuery';
export { supportsCNSRosterQuery } from './interfaces/ICNSStimulationRosterQuery';
export {
    loadCNSRosterEntries,
    keysetPage,
    computeCNSRosterFacets,
    CNS_HISTOGRAM_BUCKETS,
    buildCNSTimeHistogram,
    matchesCNSRosterFilter,
    resolveCNSPayloadPath,
    encodeCNSRosterCursor,
} from './CNSStimulationRosterCompute';
export type { TCNSRosterEntry } from './CNSStimulationRosterCompute';
export type { ICNSProgressRepository } from './interfaces/ICNSProgressRepository';
export type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
export type { TCNSRegistryNamespace } from './types/TCNSRegistryNamespace';
export type { TCNSNeuronRegistryEntry } from './types/TCNSNeuronRegistryEntry';
export type { TCNSProgressRecorderOptions } from './types/TCNSProgressRecorderOptions';
export type { TCNSDebouncedProgressRecordingStrategyOptions } from './types/TCNSDebouncedProgressRecordingStrategyOptions';

// ── resumable-execution stimulation/attempt/task model — canonical types live in
//    @cnstra/persist-dto; re-exported here for convenience ──
export type {
    TCNSSignalJSON,
    ECNSStimulationStatus,
    ECNSStimulationTaskStatus,
    ECNSStimulationVolume,
    TCNSPlannedTaskJSON,
    TCNSProgress,
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterRow,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterFacets,
    TCNSStimulationRosterTimeBucket,
    TCNSStimulationRosterCountBucket,
} from '@cnstra/persist-dto';

// ── engine ports (types only; impls to follow) ──
export type {
    ICNSStimulationRepository,
    ICNSStimulationWriter,
    ICNSStimulationReader,
} from './interfaces/ICNSStimulationRepository';
export type { ICNSStimulationPersistor } from './interfaces/ICNSStimulationPersistor';
export type { TCNSStimulationPersistorOptions } from './types/TCNSStimulationPersistorOptions';

export { portable } from './portable';
