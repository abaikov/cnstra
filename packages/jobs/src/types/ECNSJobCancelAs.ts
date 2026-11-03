import type { ECNSJobFinalStatus } from './ECNSJobFinalStatus';

export type ECNSJobCancelAs = Extract<ECNSJobFinalStatus, 'cancelled' | 'superseded'>;
