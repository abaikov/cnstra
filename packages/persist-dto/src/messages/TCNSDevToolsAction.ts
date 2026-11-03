import type { TCNSSignalJSON } from '../types/TCNSSignalJSON';
import type { TCNSProgress } from '../types/TCNSProgress';
import type { TCNSStimulationActionOptions } from './TCNSStimulationActionOptions';
import type { TCNSStimulationCommand } from '../types/TCNSStimulationCommand';

/**
 * Resume an existing run from its outstanding frontier — the panel's **Retry**.
 *
 * The identity is already assigned: this is attempt `attemptNumber` of the SAME
 * stimulation, so whatever executes it must record it under these ids rather than
 * minting its own.
 */
export type TCNSResumeRunAction = {
    type: 'resume';
    /** Correlates the panel's request with its answer; also handy in a log link. */
    requestId: string;
    stimulationId: string;
    stimulationAttemptId: string;
    attemptNumber: number;
    /** The run's originating signal, preserved across attempts. */
    entry: TCNSSignalJSON;
    /** What is left to do. A broker that re-runs the job by id may ignore it. */
    progress: TCNSProgress;
    /** Which scope (cns/graph) the run belongs to. */
    scopeName?: string;
    /** The attempt this one continues from, when known. */
    replayOf?: string;
    options?: TCNSStimulationActionOptions;
};

/**
 * Start a NEW run from an entry signal — the panel's **Clone** and **Replay**.
 *
 * The two differ only in where the signal came from: a source run's `entry`, or a
 * collateral and payload typed into the panel. To whatever executes it they are
 * the same action, so they are the same type here.
 */
export type TCNSLaunchRunAction = {
    type: 'launch';
    /** Correlates the panel's request with its answer; also handy in a log link. */
    requestId: string;
    stimulationId: string;
    stimulationAttemptId: string;
    entry: TCNSSignalJSON;
    scopeName?: string;
    /** The attempt this run was forked from — a clone's only link to its origin. */
    replayOf?: string;
    options?: TCNSStimulationActionOptions;
};

export type TCNSCommandRunAction = {
    type: 'command';
    requestId: string;
    stimulationId: string;
    command: TCNSStimulationCommand;
    scopeName?: string;
};

/** Everything the DevTools panel can ask a runtime to do. */
export type TCNSDevToolsAction = TCNSResumeRunAction | TCNSLaunchRunAction | TCNSCommandRunAction;

/**
 * One link in the chain that carries out a DevTools action.
 *
 * Call `next()` to pass the action on; return without calling it to declare the
 * action handled. That single rule covers every case a deployment has:
 *
 * - **another origin** — a link that owns the run acts and stops; one that does
 *   not simply calls `next()` (a queue adapter asks its broker whether the job
 *   exists, so ownership needs no extra bookkeeping in the model);
 * - **changing what a built-in does** — wrap it: log, authorize, rewrite the
 *   action, or refuse it outright by not calling `next()`;
 * - **after the fact** — `await next()` and then do your part.
 *
 * A chain of responsibility could only do the first of those, which is why this
 * is a middleware and not a `handle(): boolean`.
 *
 * Reaching the end of the chain without anyone acting means nothing could carry
 * the action out; the caller reports that back to the panel rather than leaving
 * a button that silently does nothing.
 */
export type TCNSDevToolsActionMiddleware = (
    action: TCNSDevToolsAction,
    next: () => Promise<void>
) => Promise<void>;
