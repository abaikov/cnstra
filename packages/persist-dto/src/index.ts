// Canonical, name-based CNStra resumable-execution data model. Zero-runtime types,
// shared by @cnstra/persist (engine) and the devtools. Topology is referenced by
// name only — it is never persisted (the code is its source of truth).

// ── shared leaf types ──
export type { TCNSSignalJSON } from './types/TCNSSignalJSON';
export type { ECNSStimulationStatus } from './types/ECNSStimulationStatus';
export type { ECNSStimulationTaskStatus } from './types/ECNSStimulationTaskStatus';
export type { ECNSStimulationVolume } from './types/ECNSStimulationVolume';

// ── frontier / resume state ──
export type { TCNSPlannedTaskJSON } from './types/TCNSPlannedTaskJSON';
export type { TCNSProgress } from './types/TCNSProgress';

// ── entities: the persisted stimulation / attempt / task model ──
export type { TCNSStimulationState } from './types/TCNSStimulationState';
export type { TCNSStimulationAttempt } from './types/TCNSStimulationAttempt';
export type { TCNSStimulationTask } from './types/TCNSStimulationTask';

// ── roster query contract (retry-UI filter / keyset / GROUP BY pushdown) ──
export type {
    TCNSStimulationRosterFilter,
    TCNSStimulationRosterRow,
    TCNSStimulationRosterPage,
    TCNSStimulationRosterCountBucket,
    TCNSStimulationRosterTimeBucket,
    TCNSStimulationRosterFacets,
} from './types/TCNSStimulationRoster';

// ── wire actions: retry / clone (panel ↔ server) ──
export type { TCNSStimulationActionOptions } from './messages/TCNSStimulationActionOptions';
export type { TCNSStimulationRetryRequest } from './messages/TCNSStimulationRetryRequest';
export type { TCNSStimulationCloneRequest } from './messages/TCNSStimulationCloneRequest';
export type { TCNSStimulationRetryAccepted } from './messages/TCNSStimulationRetryAccepted';
export type { TCNSStimulationRetryRejected } from './messages/TCNSStimulationRetryRejected';
export type { TCNSStimulationCloneAccepted } from './messages/TCNSStimulationCloneAccepted';
export type { TCNSStimulationCloneRejected } from './messages/TCNSStimulationCloneRejected';
