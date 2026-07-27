// Canonical, name-based CNStra durable-execution data model. Zero-runtime types,
// shared by @cnstra/persist (engine) and the devtools. Topology is referenced by
// name only — it is never persisted (the code is its source of truth).

// ── shared leaf types ──
export type { TCNSSignalRef } from './types/TCNSSignalRef';
export type { TCNSStimulationStatus } from './types/TCNSStimulationStatus';
export type { TCNSStimulationTaskStatus } from './types/TCNSStimulationTaskStatus';
export type { TCNSStimulationVolume } from './types/TCNSStimulationVolume';

// ── frontier / resume state ──
export type { TCNSSerializedTask } from './types/TCNSSerializedTask';
export type { TCNSProgress } from './types/TCNSProgress';

// ── entities: emit (Dto) + stored (Persisted) ──
export type { TCNSStimulationDto } from './types/TCNSStimulationDto';
export type { TCNSStimulationPersisted } from './types/TCNSStimulationPersisted';
export type { TCNSStimulationAttemptDto } from './types/TCNSStimulationAttemptDto';
export type { TCNSStimulationAttemptPersisted } from './types/TCNSStimulationAttemptPersisted';
export type { TCNSStimulationTaskDto } from './types/TCNSStimulationTaskDto';
export type { TCNSStimulationTaskPersisted } from './types/TCNSStimulationTaskPersisted';

// ── wire actions: retry / clone (panel ↔ server) ──
export type { TCNSStimulationActionOptions } from './messages/TCNSStimulationActionOptions';
export type { TCNSStimulationRetryMessage } from './messages/TCNSStimulationRetryMessage';
export type { TCNSStimulationCloneMessage } from './messages/TCNSStimulationCloneMessage';
export type { TCNSStimulationRetryAcceptedMessage } from './messages/TCNSStimulationRetryAcceptedMessage';
export type { TCNSStimulationRetryRejectedMessage } from './messages/TCNSStimulationRetryRejectedMessage';
export type { TCNSStimulationCloneAcceptedMessage } from './messages/TCNSStimulationCloneAcceptedMessage';
export type { TCNSStimulationCloneRejectedMessage } from './messages/TCNSStimulationCloneRejectedMessage';
