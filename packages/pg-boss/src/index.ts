export { createCNSWorker } from './worker';
export type { TCNSWorkerOptions } from './worker';

export { enqueueStimulation, stimulationJob } from './enqueue';
export type { TCNSSendOptions } from './enqueue';

export type {
    IPgBossLike,
    IPgBossJob,
    TCNSStimulationJobData,
    TCNSHopRecord,
    TCNSStimulationLifecycle,
    ICNSProgressSink,
    ICNSResponseLike,
} from './types';
