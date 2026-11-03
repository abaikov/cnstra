import type { ECNSJobFinalStatus } from './ECNSJobFinalStatus';
import type { TCNSJobRetention } from './TCNSJobRetention';

export type TCNSJobRetentionPolicy = Partial<Record<ECNSJobFinalStatus, TCNSJobRetention>>;
