import type { ECNSJobCancelAs } from '../types/ECNSJobCancelAs';
import type { TCNSJobAttemptOutcome } from '../types/TCNSJobAttemptOutcome';
import type { TCNSJobCancelResult } from '../types/TCNSJobCancelResult';
import type { TCNSJobClaimRequest } from '../types/TCNSJobClaimRequest';
import type { TCNSJobEnqueueOptions } from '../types/TCNSJobEnqueueOptions';
import type { TCNSJobEnqueueRequest } from '../types/TCNSJobEnqueueRequest';
import type { TCNSJobEnqueueResult } from '../types/TCNSJobEnqueueResult';
import type { TCNSJobHistoryState } from '../types/TCNSJobHistoryState';
import type { TCNSJobLease } from '../types/TCNSJobLease';
import type { TCNSJobListQuery } from '../types/TCNSJobListQuery';
import type { TCNSJobPromoteResult } from '../types/TCNSJobPromoteResult';
import type { TCNSJobRenewResult } from '../types/TCNSJobRenewResult';
import type { TCNSJobRepositoryCapabilities } from '../types/TCNSJobRepositoryCapabilities';
import type { TCNSJobRepositoryListener } from '../types/TCNSJobRepositoryListener';
import type { TCNSJobRetentionPolicy } from '../types/TCNSJobRetentionPolicy';
import type { TCNSJobSchedule } from '../types/TCNSJobSchedule';
import type { TCNSJobState } from '../types/TCNSJobState';
import type { TCNSJobTransitionResult } from '../types/TCNSJobTransitionResult';
import type { TCNSJobTypeRegistration } from '../types/TCNSJobTypeRegistration';
import type { TCNSJobTypeSchedule } from '../types/TCNSJobTypeSchedule';
import type { TCNSJobTypeStatus } from '../types/TCNSJobTypeStatus';
import type { ICNSJobLogRepository } from './ICNSJobLogRepository';
import type { ICNSJobStateRepository } from './ICNSJobStateRepository';

export interface ICNSJobRepository<TTransaction = unknown> {
    readonly capabilities: TCNSJobRepositoryCapabilities;
    readonly stateRepository: ICNSJobStateRepository;
    readonly logRepository: ICNSJobLogRepository;

    enqueue(requests: readonly TCNSJobEnqueueRequest[], options?: TCNSJobEnqueueOptions<TTransaction>): Promise<TCNSJobEnqueueResult[]>;
    claim(requests: readonly TCNSJobClaimRequest[], workerId: string): Promise<TCNSJobTransitionResult>;
    renew(leases: readonly TCNSJobLease[]): Promise<TCNSJobRenewResult>;
    finish(
        outcomes: readonly TCNSJobAttemptOutcome[],
        next?: { requests: readonly TCNSJobClaimRequest[]; workerId: string }
    ): Promise<TCNSJobTransitionResult>;
    promote(jobTypes: readonly string[], startDeadlineMs?: Readonly<Record<string, number>>): Promise<TCNSJobPromoteResult>;
    takeStale(jobTypes: readonly string[]): Promise<TCNSJobState[]>;
    repairKeys(jobTypes: readonly string[]): Promise<string[]>;
    throttle(jobType: string, jobGroup: string | undefined, nextStartAt: number | undefined): Promise<void>;

    cancel(jobIds: readonly string[], as?: ECNSJobCancelAs): Promise<TCNSJobCancelResult>;
    retry(jobIds: readonly string[]): Promise<string[]>;
    runNow(jobIds: readonly string[]): Promise<string[]>;
    prioritize(jobIds: readonly string[], priority: number): Promise<string[]>;
    remove(jobIds: readonly string[]): Promise<string[]>;
    get(jobId: string): Promise<TCNSJobState | TCNSJobHistoryState | undefined>;
    list(query?: TCNSJobListQuery): Promise<TCNSJobState[]>;
    maintain(
        retention: Readonly<Record<string, TCNSJobRetentionPolicy>>,
        dedupWindowMs: Readonly<Record<string, number>>,
        horizonMs?: number
    ): Promise<string[]>;

    upsertSchedules(jobType: string, schedules: readonly TCNSJobSchedule[], fromDefinition: boolean): Promise<void>;
    removeSchedules(jobType: string, scheduleIds: readonly string[]): Promise<void>;
    listSchedules(jobTypes: readonly string[]): Promise<TCNSJobTypeSchedule[]>;

    registerTypes(registrations: readonly TCNSJobTypeRegistration[]): Promise<() => Promise<void>>;
    listTypes(): Promise<TCNSJobTypeStatus[]>;
    subscribe(listener: TCNSJobRepositoryListener): Promise<() => Promise<void>>;
}
