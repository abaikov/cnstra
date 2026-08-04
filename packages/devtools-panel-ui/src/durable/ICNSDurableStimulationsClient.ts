import type { TCNSStimulationViewDTO } from '@cnstra/devtools-dto';

/**
 * Transport-agnostic client for the durable-runs admin.
 *
 * The admin is a POLLING surface — call `listStimulations()` on an interval; the actions
 * mutate and the next poll reflects them. HTTP today (CNSDurableStimulationsHttpClient);
 * gRPC / WS / in-process could implement the same seam without touching the page.
 */
export interface ICNSDurableStimulationsClient {
    /** Poll the full run roster (roster → attempts → tasks). */
    listStimulations(): Promise<TCNSStimulationViewDTO[]>;
    /** Which execution backend the server runs (e.g. "in-process", "bullmq (redis)"). */
    info(): Promise<{ backend: string }>;
    /** Launch a brand-new run; returns its id. `fail` seeds a failing attempt. */
    launch(params: { fail: boolean; userId?: string }): Promise<string>;
    /** Retry a failed run: resume its outstanding frontier. */
    retry(stimulationId: string): Promise<void>;
    /** Clone a run: a fresh run from the same entry; returns the new id. */
    clone(stimulationId: string): Promise<string>;
}
