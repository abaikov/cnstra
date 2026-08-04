export { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
export { CNSPersistOptionsRegistryFactory } from './CNSPersistOptionsRegistryFactory';

export { CNSProgressSerializer } from './CNSProgressSerializer';
export { CNSInMemoryProgressRepository } from './CNSInMemoryProgressRepository';

export { CNSProgressRecorder } from './CNSProgressRecorder';
export { CNSDebouncedProgressRecordingStrategy } from './CNSDebouncedProgressRecordingStrategy';

export { CNSStimulationPersistor } from './CNSStimulationPersistor';
export { CNSInMemoryStimulationRepository } from './CNSInMemoryStimulationRepository';
export type { TCNSInMemoryStimulationRepositoryOptions } from './CNSInMemoryStimulationRepository';

export type { ICNSStimulationRosterQuery } from './interfaces/ICNSStimulationRosterQuery';
export { supportsRosterQuery } from './interfaces/ICNSStimulationRosterQuery';
export {
    loadRosterEntries,
    keysetPage,
    computeRosterFacets,
    buildTimeHistogram,
    matchesRosterFilter,
    resolvePayloadPath,
    encodeRosterCursor,
} from './CNSStimulationRosterCompute';
export type { TCNSRosterEntry } from './CNSStimulationRosterCompute';
export type { ICNSProgressRepository } from './interfaces/ICNSProgressRepository';
export type { ICNSProgressRecordingStrategy } from './interfaces/ICNSProgressRecordingStrategy';
export type { TCNSRegistryValue } from './types/TCNSRegistryValue';
export type { TCNSNeuronRegistryEntry } from './types/TCNSNeuronRegistryEntry';
export type { TCNSProgressRecorderOptions } from './types/TCNSProgressRecorderOptions';
export type { TCNSDebouncedProgressRecordingStrategyOptions } from './types/TCNSDebouncedProgressRecordingStrategyOptions';

// ── durable-execution stimulation/attempt/task model — canonical types live in
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
