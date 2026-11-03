// The id grammar lives in @cnstra/persist-dto — it is a property of the
// resumable model, not of the devtools. Re-exported so existing imports hold.
export { buildCNSAttemptId, buildCNSCloneId } from '@cnstra/persist-dto';
export * from './schemas/entities';
export * from './schemas/app-messages';
export * from './schemas/app-commands';
export * from './schemas/signal';
export * from './schemas/stimulations-query';
export * from './schemas/scheduled-stimulations-query';
export * from './schemas/client-messages';
export * from './schemas/server-messages';

// Canonical, name-based resumable-execution model — re-exported from @cnstra/persist-dto.
// The devtools carry this model directly; there are no legacy id-based entities.
export type {
    TCNSStimulationState,
    TCNSStimulationAttempt,
    TCNSStimulationTask,
    TCNSProgress,
    TCNSPlannedTaskJSON,
    TCNSSignalJSON,
    ECNSStimulationStatus,
    ECNSStimulationTaskStatus,
    ECNSStimulationVolume,
} from '@cnstra/persist-dto';
