import type { CNSCollateral } from '@cnstra/core';
import type { CNSPersistOptionsRegistry, TCNSSignalRef } from '@cnstra/persist';
import { CNSStimulationPersistor, CNSProgressSerializer } from '@cnstra/persist';
import type { ICNS, TCNSNeuron } from '@cnstra/types';
import { CNSStimulationContextStore } from '@cnstra/core';
import type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
import { CNSWireStimulationRepository } from './CNSWireStimulationRepository';
import type {
    CNSDTOAppBatchItem,
    CNSDTOCollateral,
    CNSDTODendrite,
    CNSDTONeuron,
    CNSDTOReplayStartMessage,
    CNSDTOAppCommand,
} from '@cnstra/devtools-dto';

/**
 * A server-forwarded resume/launch command pre-assigns the durable identity for
 * the very next stimulation this instance runs. It is consumed by the global
 * response listener on that stimulation's first response — since `cns.activate`/
 * `cns.stimulate` pump the first response synchronously (single-threaded), the
 * override cannot be claimed by any interleaved stimulation.
 */
type TDurableOverride = {
    stimulationId: string;
    stimulationAttemptId: string;
    attemptNumber: number;
    entry: TCNSSignalRef[];
    scopeName?: string;
};

export type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
export { CNSWireStimulationRepository } from './CNSWireStimulationRepository';
export { dumpCNSGraph, CNSHistoryLogger } from './inspect';
export type { CNSHistoryLoggerOptions } from './inspect';

export type CNSDevToolsOptions = {
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

type AnyNeuron = TCNSNeuron<any, any>;
type AnyCollateral = CNSCollateral<unknown>;

let stimulationCounter = 0;
const newStimulationId = (appId: string) => `${appId}:stim:${++stimulationCounter}:${Date.now()}`;

export class CNSDevTools {
    private readonly buffer: CNSDTOAppBatchItem[] = [];
    private unregisterReplay?: () => void;
    private unregisterCommand?: () => void;
    /** Set just before a server-driven activate/stimulate; consumed on first response. */
    private pendingDurableOverride?: TDurableOverride;
    /** One-shot guard so a missing-registration warning isn't logged per response. */
    private durableWarned = false;

    constructor(
        private readonly appId: string,
        private readonly transport: ICNSDevToolsTransport,
        private readonly options: CNSDevToolsOptions = {}
    ) {}

    registerCNS(cns: ICNS<AnyNeuron>, registry: CNSPersistOptionsRegistry): void {
        const cnsId = this.options.cnsId ?? `${this.appId}:cns`;

        this.sendTopology(cns, registry, cnsId);
        this.listenToStimulations(cns, registry, cnsId);

        if (this.transport.onReplayStart) {
            this.unregisterReplay = this.transport.onReplayStart(
                cmd => this.handleReplay(cns, registry, cnsId, cmd)
            );
        }

        if (this.options.trackStimulations && this.transport.onStimulationCommand) {
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
        const neurons: CNSDTONeuron[] = [];
        const collaterals: CNSDTOCollateral[] = [];
        const dendrites: CNSDTODendrite[] = [];

        for (const [neuronName, neuron] of registry.getNamedNeurons()) {
            const neuronId = `${cnsId}:${neuronName}`;
            neurons.push({ id: neuronId, name: neuronName, cnsId, appId: this.appId });

            for (const [colKey, col] of Object.entries(neuron.axon)) {
                const colName = registry.getCollateralName(col as AnyCollateral) ?? colKey;
                const colId = `${neuronId}:${colName}`;
                collaterals.push({ id: colId, name: colName, neuronId, cnsId, appId: this.appId });
            }

            for (const dendrite of neuron.dendrites) {
                const col = dendrite.collateral as AnyCollateral;
                const colId = this.resolveCollateralId(col, cnsId, cns, registry);
                const colName = registry.getCollateralName(col) ?? 'unknown';
                const dendriteId = `${neuronId}:d:${colName}`;
                dendrites.push({ id: dendriteId, neuronId, collateralId: colId, cnsId, appId: this.appId });
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

    private listenToStimulations(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string
    ): void {
        // Name-based durable model — the SOLE stimulation/hop emit path. A
        // per-stimulation {@link CNSStimulationPersistor}, keyed by the live core
        // stimulation object, streams Stimulation → Attempt → Task (all by name) to
        // the wire; the server persists + serves them, the panel renders them.
        const persistors = new WeakMap<object, CNSStimulationPersistor>();
        const seen = new WeakSet<object>();
        // An app can opt out of all stimulation observability with `false`.
        const emit = this.options.trackStimulations !== false;
        if (!emit) return;

        cns.addResponseListener((resp: any) => {
            const stimulation = resp.stimulation;
            if (!stimulation) return;

            if (!seen.has(stimulation)) {
                seen.add(stimulation);

                // A server-forwarded retry/clone pre-assigns this stimulation's
                // durable identity (stable stimulationId + attempt number + the
                // origin entry). Absent an override this is a fresh, app-initiated
                // stimulation → mint attempt #1 and derive the entry from the first
                // response.
                const override = this.pendingDurableOverride;
                this.pendingDurableOverride = undefined;

                const triggerCol = resp.outputSignal?.collateral as AnyCollateral | undefined;
                const entryName = triggerCol
                    ? registry.getCollateralName(triggerCol) ?? '(entry)'
                    : '(entry)';
                const entry: TCNSSignalRef[] = override?.entry ?? [
                    {
                        collateralName: entryName,
                        payload: resp.outputSignal?.payload,
                    },
                ];
                const stimId = override?.stimulationId ?? newStimulationId(this.appId);
                const persistor = new CNSStimulationPersistor({
                    // Each durable write both enqueues AND flushes, so the terminal
                    // records aren't stranded behind a later flush.
                    repository: new CNSWireStimulationRepository(item => {
                        this.enqueue(item);
                        void this.flush();
                    }),
                    registry,
                    stimulationId: stimId,
                    stimulationAttemptId:
                        override?.stimulationAttemptId ?? `${stimId}#1`,
                    attemptNumber: override?.attemptNumber ?? 1,
                    entry,
                    volume: 'full',
                    scopeName: override?.scopeName ?? cnsId,
                });
                persistors.set(stimulation, persistor);

                stimulation.waitUntilComplete()
                    .then(() => persistor.dispose())
                    .catch(() => persistor.dispose());
            }

            // Crash-safety: the serializer THROWS if a frontier neuron/collateral is
            // not registered (see CNSPersistOptionsRegistry). For observability that
            // must not take down the host app — log once per instance and skip.
            try {
                persistors.get(stimulation)?.onResponse(resp);
            } catch (e) {
                if (!this.durableWarned) {
                    this.durableWarned = true;
                    // eslint-disable-next-line no-console
                    console.warn(
                        '[CNSDevTools] durable stimulation tracking skipped a response — ' +
                            'register every neuron and collateral in the frontier ' +
                            '(incl. entry collaterals) to enable it:',
                        e
                    );
                }
            }
        });
    }

    // ─── Replay ───────────────────────────────────────────────────────────────────

    private handleReplay(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string,
        cmd: CNSDTOReplayStartMessage
    ): void {
        const colIdParts = cmd.collateralId.split(':');
        const colName = colIdParts[colIdParts.length - 1];

        let targetCollateral: AnyCollateral | undefined;
        for (const [, neuron] of registry.getNamedNeurons()) {
            for (const [, col] of Object.entries(neuron.axon)) {
                const name = registry.getCollateralName(col as AnyCollateral);
                if (name === colName) {
                    targetCollateral = col as AnyCollateral;
                    break;
                }
            }
            if (targetCollateral) break;
        }
        // Also check standalone collaterals
        if (!targetCollateral) {
            const col = registry.getCollateral(colName);
            if (col) targetCollateral = col;
        }

        if (!targetCollateral) {
            if (this.options.consoleLogEnabled) {
                console.warn(`[DevTools] Replay: collateral not found: ${cmd.collateralId}`);
            }
            return;
        }

        const ctx = new CNSStimulationContextStore();

        const signal = targetCollateral.createSignal(cmd.payload);
        const stimulation = cns.stimulate(signal, {
            ...(cmd.options?.maxHops ? { maxNeuronHops: cmd.options.maxHops } : {}),
            ...(cmd.options?.timeoutMs ? (() => {
                const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
                if (ac) setTimeout(() => ac.abort(), cmd.options!.timeoutMs);
                return ac ? { abortSignal: ac.signal } : {};
            })() : {}),
            ctx,
        });

        // The stimulation.started for this run is emitted by listenToStimulations;
        // the replay is correlated separately via replayId.
        const replayId = cmd.replayId;
        if (this.options.consoleLogEnabled) {
            console.log(`[DevTools] Replay started: replayId=${replayId}`);
        }

        void stimulation.waitUntilComplete()
            .then(() => {
                if (this.options.consoleLogEnabled) {
                    console.log(`[DevTools] Replay completed: replayId=${replayId}`);
                }
            })
            .catch((e) => {
                if (this.options.consoleLogEnabled) {
                    console.warn(`[DevTools] Replay failed: replayId=${replayId}`, e);
                }
            });
    }

    // ─── Durable actions (retry / clone), Phase 2b-2 ──────────────────────────────

    /**
     * Execute a server-forwarded durable action. The server has already assigned
     * the durable identity (stimulationId + attempt number) and enriched the
     * command from the store; here we hydrate against THIS app's registry and run
     * it. The new attempt streams back through the normal name-based path — we set
     * {@link pendingDurableOverride} so the global response listener stamps it with
     * the given identity instead of minting a fresh one.
     */
    private handleStimulationCommand(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        cnsId: string,
        cmd: CNSDTOAppCommand
    ): void {
        if (cmd.type === 'cns.stimulation.resume') {
            // Resume the stored frontier as a new attempt of the SAME stimulation.
            const serializer = new CNSProgressSerializer(registry);
            const { tasks, ctx } = serializer.hydrate(cmd.progress);
            if (tasks.length === 0) {
                if (this.options.consoleLogEnabled)
                    console.warn(`[DevTools] Resume: empty frontier for ${cmd.stimulationId}`);
                return;
            }
            this.pendingDurableOverride = {
                stimulationId: cmd.stimulationId,
                stimulationAttemptId: cmd.stimulationAttemptId,
                attemptNumber: cmd.attemptNumber,
                entry: [cmd.entry],
                scopeName: cmd.scopeName ?? cnsId,
            };
            const stimulation = cns.activate(tasks, {
                ctx,
                stimulationContext: {
                    stimulationId: cmd.stimulationId,
                    attemptNumber: cmd.attemptNumber,
                },
                ...this.actionOptions(cmd.options),
            });
            void stimulation.waitUntilComplete().catch(() => {});
            return;
        }

        // clone: a fresh stimulation (new id, attempt 1) re-fired from the entry.
        const col = this.resolveCollateralByName(registry, cmd.entry.collateralName);
        if (!col) {
            if (this.options.consoleLogEnabled)
                console.warn(`[DevTools] Clone: entry collateral not found: ${cmd.entry.collateralName}`);
            return;
        }
        this.pendingDurableOverride = {
            stimulationId: cmd.stimulationId,
            stimulationAttemptId: cmd.stimulationAttemptId,
            attemptNumber: 1,
            entry: [cmd.entry],
            scopeName: cmd.scopeName ?? cnsId,
        };
        const stimulation = cns.stimulate(col.createSignal(cmd.entry.payload), {
            stimulationContext: {
                stimulationId: cmd.stimulationId,
                attemptNumber: 1,
            },
            ...this.actionOptions(cmd.options),
        });
        void stimulation.waitUntilComplete().catch(() => {});
    }

    /** Map name-based action options → core stimulation options. */
    private actionOptions(
        options: CNSDTOAppCommand['options']
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

    /** Look a collateral up by its registered name (axon or standalone entry). */
    private resolveCollateralByName(
        registry: CNSPersistOptionsRegistry,
        name: string
    ): AnyCollateral | undefined {
        const standalone = registry.getCollateral(name);
        if (standalone) return standalone as AnyCollateral;
        for (const [, neuron] of registry.getNamedNeurons()) {
            for (const [, col] of Object.entries(neuron.axon)) {
                if (registry.getCollateralName(col as AnyCollateral) === name)
                    return col as AnyCollateral;
            }
        }
        return undefined;
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

    private enqueue(item: CNSDTOAppBatchItem): void {
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

    destroy(): void {
        this.unregisterReplay?.();
        this.unregisterCommand?.();
        this.buffer.length = 0;
    }
}
