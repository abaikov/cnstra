import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry, TCNSSignalJSON } from '@cnstra/persist';
import { CNSStimulationPersistor, CNSProgressSerializer } from '@cnstra/persist';
import type { ICNS, ICNSStimulation, TCNSNeuron } from '@cnstra/types';
import type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
import { CNSWireStimulationRepository } from './CNSWireStimulationRepository';
import { buildCNSAttemptId } from '@cnstra/devtools-dto';
import type {
    TCNSAppBatchItemDTO,
    TCNSCollateralDTO,
    TCNSDendriteDTO,
    TCNSNeuronDTO,
    TCNSAppCommandDTO,
} from '@cnstra/devtools-dto';

/**
 * The resumable identity a server-forwarded resume/launch command pre-assigns to
 * the run it forwards. It is bound to that ONE stimulation object (see
 * {@link CNSDevTools.runWithAssignedIdentity}) and read by the global response
 * listener when that stimulation first reports.
 *
 * It is deliberately NOT "the identity of the next run this process reports":
 * `cns.activate` over a frontier whose first neuron is async returns having
 * emitted nothing, and any run started by anyone else in that window — an HTTP
 * handler, a queue worker — would report first and be recorded as the retry.
 */
type TStimulationOverride = {
    stimulationId: string;
    stimulationAttemptId: string;
    attemptNumber: number;
    entry: TCNSSignalJSON[];
    scopeName?: string;
    /** The attempt this run was forked from (Clone provenance). */
    replayOf?: string;
};

export type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
export { CNSWireStimulationRepository } from './CNSWireStimulationRepository';
export { dumpCNSGraph, CNSHistoryLogger } from './inspect';
export type { TCNSHistoryLoggerOptions } from './inspect';

export type TCNSDevToolsOptions = {
    /** Explicit CNS ID. If omitted, derived as `${appId}:cns`. */
    cnsId?: string;
    /** Human-readable app name shown in DevTools UI. */
    appName?: string;
    /** App version. */
    version?: string;
    /** Max items per batch before force flush (default: 100). */
    batchMaxSize?: number;
    /** When true, log transport events to console. */
    consoleLogEnabled?: boolean;
    /**
     * Track stimulations: emit the name-based model (Stimulation → Attempt → Task,
     * all by name) via a per-stimulation {@link CNSStimulationPersistor} — the sole
     * stimulation observability path. Default **on**; set `false` to disable
     * stimulation tracking entirely. The `scopeName` of every emitted stimulation is
     * the cns id.
     */
    trackStimulations?: boolean;
};

type AnyNeuron = TCNSNeuron<any>;
type AnyCollateral = CNSCollateral<unknown>;

let stimulationCounter = 0;
const newStimulationId = (appId: string) => `${appId}:stim:${++stimulationCounter}:${Date.now()}`;

export class CNSDevTools {
    private readonly buffer: TCNSAppBatchItemDTO[] = [];
    private unregisterCommand?: () => void;
    private unregisterResponses?: () => void;
    /**
     * Identity assigned by a server-driven activate/stimulate, keyed by the exact
     * stimulation it was assigned FOR. Nothing is ever armed process-wide, so a
     * concurrently started run cannot claim it. Weak, so a run that never reports
     * (e.g. an aborted one) drops its entry with the stimulation itself.
     */
    private readonly assignedIdentities = new WeakMap<object, TStimulationOverride>();
    /** One-shot guard so a missing-registration warning isn't logged per response. */
    private resumeWarned = false;

    constructor(
        private readonly appId: string,
        private readonly transport: ICNSDevToolsTransport,
        private readonly options: TCNSDevToolsOptions = {}
    ) {}

    /**
     * Stimulation tracking is opt-OUT: only an explicit `false` disables it. Read
     * through this getter EVERYWHERE the option is consulted — a second reading of
     * the raw option is how the resume/clone command handler silently stopped being
     * registered for every app that relies on the documented default.
     */
    private get tracksStimulations(): boolean {
        return this.options.trackStimulations !== false;
    }

    registerCNS(cns: ICNS<AnyNeuron>, registry: CNSPersistOptionsRegistry): void {
        // Re-registering must not stack a second set of listeners on the same CNS:
        // two live response listeners emit every task row twice, under two
        // independent task numberings.
        this.unregisterAll();

        const cnsId = this.options.cnsId ?? `${this.appId}:cns`;

        this.sendTopology(cns, registry, cnsId);
        this.unregisterResponses = this.listenToStimulations(cns, registry, cnsId);

        if (this.tracksStimulations && this.transport.onStimulationCommand) {
            this.unregisterCommand = this.transport.onStimulationCommand(
                cmd => this.handleStimulationCommand(cns, registry, cnsId, cmd)
            );
        }
    }

    // ─── Topology ────────────────────────────────────────────────────────────────

    private sendTopology(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string
    ): void {
        const neurons: TCNSNeuronDTO[] = [];
        const collaterals: TCNSCollateralDTO[] = [];
        const dendrites: TCNSDendriteDTO[] = [];
        const named = [...registry.getNamedNeurons()];

        // Pass 1: every axon (owned) collateral NAME. Collateral names are unique
        // within a cns, so a dendrite whose collateral name is already an axon name
        // IS that owned collateral — only a name NOT seen here is a standalone
        // entry/external collateral that must be emitted separately.
        const axonCollateralNames = new Set<string>();
        for (const [, neuron] of named) {
            for (const [colKey, col] of Object.entries(neuron.axon)) {
                axonCollateralNames.add(registry.getCollateralName(col as AnyCollateral) ?? colKey);
            }
        }

        // Pass 2: emit neurons, their axon collaterals, and dendrites — plus any
        // ENTRY/external collateral a dendrite subscribes to that no axon owns
        // (owner 'unknown'). Without this the panel can't resolve those dendrites'
        // collateralId → the neuron looks like it has no inputs.
        const standaloneEmitted = new Set<string>();
        for (const [neuronName, neuron] of named) {
            neurons.push({ name: neuronName, cnsId, appId: this.appId });

            for (const [colKey, col] of Object.entries(neuron.axon)) {
                const colName = registry.getCollateralName(col as AnyCollateral) ?? colKey;
                collaterals.push({ name: colName, ownerNeuronName: neuronName, cnsId, appId: this.appId });
            }

            for (const dendrite of neuron.dendrites) {
                const col = dendrite.collateral as AnyCollateral;
                const colName = registry.getCollateralName(col) ?? 'unknown';
                dendrites.push({ neuronName, collateralName: colName, cnsId, appId: this.appId });

                // An entry/external collateral no axon owns: emit it (owner absent)
                // so the panel can render this neuron's input subscription.
                if (!axonCollateralNames.has(colName) && !standaloneEmitted.has(colName)) {
                    standaloneEmitted.add(colName);
                    collaterals.push({ name: colName, cnsId, appId: this.appId });
                }
            }
        }

        this.enqueue({
            type: 'topology',
            cnsId,
            appId: this.appId,
            appName: this.options.appName ?? this.appId,
            version: this.options.version ?? '0.0.0',
            timestamp: Date.now(),
            neurons,
            collaterals,
            dendrites,
        });
        void this.flush();
    }

    // ─── Stimulation tracking ─────────────────────────────────────────────────────

    /** Returns the unsubscribe for the global response listener it installs. */
    private listenToStimulations(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string
    ): (() => void) | undefined {
        // Name-based resumable model — the SOLE stimulation/hop emit path. A
        // per-stimulation {@link CNSStimulationPersistor}, keyed by the live core
        // stimulation object, streams Stimulation → Attempt → Task (all by name) to
        // the wire; the server persists + serves them, the panel renders them.
        const persistors = new WeakMap<object, CNSStimulationPersistor>();
        const seen = new WeakSet<object>();
        // An app can opt out of all stimulation observability with `false`.
        if (!this.tracksStimulations) return undefined;

        // The same serialization the persistor performs on flush, run here so its
        // failure is ours to handle — see the crash-safety note below.
        const frontierSerializer = new CNSProgressSerializer(registry);

        return cns.addResponseListener((resp: any) => {
            const stimulation = resp.stimulation;
            if (!stimulation) return;

            if (!seen.has(stimulation)) {
                seen.add(stimulation);

                // A server-forwarded retry/clone pre-assigns THIS stimulation's
                // resumable identity (stable stimulationId + attempt number + the
                // origin entry) — looked up by the stimulation object, so only the
                // run the identity was assigned for can wear it. Absent one this is
                // a fresh, app-initiated stimulation → mint attempt #1 and derive
                // the entry from the first response.
                const override = this.assignedIdentities.get(stimulation);
                this.assignedIdentities.delete(stimulation);

                const triggerCol = resp.outputSignal?.collateral as AnyCollateral | undefined;
                const entryName = triggerCol
                    ? registry.getCollateralName(triggerCol) ?? '(entry)'
                    : '(entry)';
                const entry: TCNSSignalJSON[] = override?.entry ?? [
                    {
                        collateralName: entryName,
                        payload: resp.outputSignal?.payload,
                    },
                ];
                const stimId = override?.stimulationId ?? newStimulationId(this.appId);
                const persistor = new CNSStimulationPersistor({
                    // Each resumable write both enqueues AND flushes, so the terminal
                    // records aren't stranded behind a later flush.
                    repository: new CNSWireStimulationRepository(item => {
                        this.enqueue(item);
                        void this.flush();
                    }),
                    registry,
                    stimulationId: stimId,
                    stimulationAttemptId:
                        override?.stimulationAttemptId ?? buildCNSAttemptId(stimId, 1),
                    attemptNumber: override?.attemptNumber ?? 1,
                    entry,
                    volume: 'full',
                    scopeName: override?.scopeName ?? cnsId,
                    ...(override?.replayOf ? { replayOf: override.replayOf } : {}),
                });
                persistors.set(stimulation, persistor);

                stimulation.waitUntilComplete()
                    .then(() => persistor.dispose())
                    .catch(() => persistor.dispose());
            }

            const persistor = persistors.get(stimulation);
            if (!persistor) return;

            // Crash-safety: the serializer THROWS if a frontier neuron/collateral is
            // not registered (see CNSPersistOptionsRegistry). Wrapping `onResponse`
            // in a try/catch does NOT catch that: `onResponse` only schedules
            // `void this.flush(...)`, and the throw happens inside that async flush,
            // after an await — i.e. as a rejected promise nobody observes, which
            // terminates the host process. So serialize the SAME frontier here,
            // synchronously, before the persistor can schedule a flush over it. On
            // failure: warn once, drop this stimulation's persistor and dispose it
            // (cancelling any debounced flush still pending, which would otherwise
            // reject over the same bad frontier). Observability degrades for this
            // run; the app stays up.
            //
            // This listener must also never throw: a global response listener that
            // throws is recorded by the core and REJECTS the app's own stimulation.
            try {
                frontierSerializer.serialize(stimulation);
                persistor.onResponse(resp);
            } catch (e) {
                persistors.delete(stimulation);
                persistor.dispose();
                if (!this.resumeWarned) {
                    this.resumeWarned = true;
                    // eslint-disable-next-line no-console
                    console.warn(
                        '[CNSDevTools] resumable stimulation tracking skipped a response — ' +
                            'register every neuron and collateral in the frontier ' +
                            '(incl. entry collaterals) to enable it:',
                        e
                    );
                }
            }
        });
    }

    // ─── Resumable actions (retry / clone), Phase 2b-2 ──────────────────────────────

    /**
     * Execute a server-forwarded resumable action. The server has already assigned
     * the resumable identity (stimulationId + attempt number) and enriched the
     * command from the store; here we hydrate against THIS app's registry and run
     * it. The new attempt streams back through the normal name-based path — we bind
     * the assigned identity to the stimulation via {@link runWithAssignedIdentity} so
     * the global response listener stamps THAT run with it instead of minting a
     * fresh one.
     */
    private handleStimulationCommand(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string,
        cmd: TCNSAppCommandDTO
    ): void {
        if (cmd.type === 'cns.stimulation.resume') {
            // Resume the stored frontier as a new attempt of the SAME stimulation.
            const serializer = new CNSProgressSerializer(registry);
            const { tasks } = serializer.hydrate(cmd.progress);
            if (tasks.length === 0) {
                if (this.options.consoleLogEnabled)
                    console.warn(`[DevTools] Resume: empty frontier for ${cmd.stimulationId}`);
                return;
            }
            // The attempt's `entry` is the input SET it was activated with — for a
            // resume that is the frontier, not the signal the run first started
            // from. Recording one signal makes `k = 1`, and then every task of
            // this attempt whose producer has not appeared yet falls back to
            // input slot 0: the history claims they all consumed the original
            // entry, which is not what they ran on. The frontier's own inputs are
            // right here, so use them.
            const resumeEntry = cmd.progress.tasks
                .map(task => task.input)
                .filter((input): input is TCNSSignalJSON => !!input);

            this.runWithAssignedIdentity(
                {
                    stimulationId: cmd.stimulationId,
                    stimulationAttemptId: cmd.stimulationAttemptId,
                    attemptNumber: cmd.attemptNumber,
                    entry: resumeEntry.length ? resumeEntry : [cmd.entry],
                    scopeName: cmd.scopeName ?? cnsId,
                    replayOf: cmd.replayOf,
                },
                onResponse =>
                    cns.activate(tasks, {
                        stimulationContext: {
                            stimulationId: cmd.stimulationId,
                            attemptNumber: cmd.attemptNumber,
                        },
                        onResponse,
                        ...this.actionOptions(cmd.options),
                    })
            );
            return;
        }

        // clone: a fresh stimulation (new id, attempt 1) re-fired from the entry.
        const col = registry.getCollateral(cmd.entry.collateralName) as AnyCollateral | undefined;
        if (!col) {
            if (this.options.consoleLogEnabled)
                console.warn(`[DevTools] Clone: entry collateral not found: ${cmd.entry.collateralName}`);
            return;
        }
        this.runWithAssignedIdentity(
            {
                stimulationId: cmd.stimulationId,
                stimulationAttemptId: cmd.stimulationAttemptId,
                attemptNumber: 1,
                entry: [cmd.entry],
                scopeName: cmd.scopeName ?? cnsId,
                replayOf: cmd.replayOf,
            },
            onResponse =>
                cns.stimulate(col.createSignal(cmd.entry.payload), {
                    stimulationContext: {
                        stimulationId: cmd.stimulationId,
                        attemptNumber: 1,
                    },
                    onResponse,
                    ...this.actionOptions(cmd.options),
                })
        );
    }

    /**
     * Start a server-forwarded run under a pre-assigned resumable identity, bound
     * to the stimulation that run IS — never to "whatever reports next".
     *
     * The binding happens at the first of two moments, whichever comes first:
     *
     *  - from the run's own `onResponse`, which the engine calls before the global
     *    response listeners for that same response (`CNS.wrapOnResponse`). This
     *    covers a run that emits its entry response synchronously, i.e. before
     *    `stimulate` has returned anything to bind (the clone path);
     *  - from the returned stimulation. This covers a run that emits nothing
     *    before returning — `activate` over a hydrated frontier whose first neuron
     *    is async (the resume path).
     *
     * Because nothing is armed process-wide, a run started by anyone else in that
     * window (an HTTP handler, a queue worker) cannot be recorded under this
     * identity, and a throw out of `start` leaves no identity behind for the next
     * run to pick up.
     */
    private runWithAssignedIdentity(
        override: TStimulationOverride,
        start: (
            onResponse: (response: { stimulation?: object }) => void
        ) => ICNSStimulation<AnyNeuron>
    ): void {
        let bound = false;
        const bind = (target: object | undefined): void => {
            if (bound || !target) return;
            bound = true;
            this.assignedIdentities.set(target, override);
        };

        // Returns void, never a promise: a promise here would be taken as a
        // barrier and park the run's subscribers on it.
        const stimulation = start(response => bind(response?.stimulation));
        bind(stimulation);
        void stimulation.waitUntilComplete().catch(() => {});
    }

    /** Map name-based action options → core stimulation options. */
    private actionOptions(
        options: TCNSAppCommandDTO['options']
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        if (options?.maxHops) out.maxNeuronHops = options.maxHops;
        if (options?.timeoutMs && typeof AbortController !== 'undefined') {
            const ac = new AbortController();
            setTimeout(() => ac.abort(), options.timeoutMs);
            out.abortSignal = ac.signal;
        }
        return out;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    private resolveCollateralId(
        col: AnyCollateral | null,
        cnsId: string,
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry
    ): string {
        if (!col) return `${cnsId}:unknown`;
        const name = registry.getCollateralName(col);
        if (!name) return `${cnsId}:unknown`;
        const owner = cns.network.getParentNeuronByCollateral(col);
        const ownerName = owner ? registry.getNeuronName(owner as AnyNeuron) : null;
        return ownerName ? `${cnsId}:${ownerName}:${name}` : `${cnsId}:external:${name}`;
    }

    private enqueue(item: TCNSAppBatchItemDTO): void {
        this.buffer.push(item);
    }

    private async flush(): Promise<void> {
        if (this.buffer.length === 0) return;
        const items = this.buffer.splice(0, this.buffer.length);
        await this.transport.sendBatch({ type: 'batch', items });
    }

    private safeValue(value: unknown, seen = new WeakSet<object>()): unknown {
        if (value === null || value === undefined) return value ?? null;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'function') return '[Function]';
        if (typeof value === 'symbol') return String(value);
        if (value instanceof Error) return { name: value.name, message: value.message };
        if (Array.isArray(value)) return value.map(v => this.safeValue(v, seen));
        if (typeof value === 'object') {
            if (seen.has(value as object)) return '[Circular]';
            seen.add(value as object);
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                out[k] = this.safeValue(v, seen);
            }
            return out;
        }
        return value;
    }

    /**
     * Release every subscription this instance holds. The global response listener
     * is included: `addResponseListener` returns an unsubscribe, and dropping it
     * leaves the listener attached to the app's CNS forever.
     */
    private unregisterAll(): void {
        this.unregisterResponses?.();
        this.unregisterResponses = undefined;
        this.unregisterCommand?.();
        this.unregisterCommand = undefined;
    }

    destroy(): void {
        this.unregisterAll();
        this.buffer.length = 0;
    }
}
