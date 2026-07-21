import type { ICNS, TCNSNeuron, CNSCollateral, CNSPersistOptionsRegistry } from '@cnstra/core';
import { CNSStimulationContextStore } from '@cnstra/core';
import type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
import type {
    CNSDTOAppBatchItem,
    CNSDTOCollateral,
    CNSDTODendrite,
    CNSDTOStimulation,
    CNSDTOHop,
    CNSDTONeuron,
    CNSDTOReplayStartMessage,
} from '@cnstra/devtools-dto';

export type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
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
};

type AnyNeuron = TCNSNeuron<any, any>;
type AnyCollateral = CNSCollateral<unknown>;

let stimulationCounter = 0;
const newStimulationId = (appId: string) => `${appId}:stim:${++stimulationCounter}:${Date.now()}`;

export class CNSDevTools {
    private readonly buffer: CNSDTOAppBatchItem[] = [];
    private unregisterReplay?: () => void;

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
        // Maps a live core stimulation object → its DTO stimulation id.
        const stimulationIds = new WeakMap<object, string>();
        const hopIndexes = new WeakMap<object, number>();

        cns.addResponseListener((resp: any) => {
            const stimulation = resp.stimulation;
            if (!stimulation) return;

            const isFirst = !stimulationIds.has(stimulation);

            if (isFirst) {
                const stimId = newStimulationId(this.appId);
                stimulationIds.set(stimulation, stimId);
                hopIndexes.set(stimulation, 0);

                const triggerCol = resp.outputSignal?.collateral as AnyCollateral | undefined;
                const collateralId = triggerCol
                    ? this.resolveCollateralId(triggerCol, cnsId, cns, registry)
                    : `${cnsId}:unknown`;

                const dtoStimulation: CNSDTOStimulation = {
                    id: stimId,
                    cnsId,
                    appId: this.appId,
                    collateralId,
                    payload: this.safeValue(resp.outputSignal?.payload),
                    startedAt: Date.now(),
                    completedAt: null,
                    hopCount: 0,
                    hasError: false,
                    replayOf: null,
                };
                this.enqueue({ type: 'stimulation.started', stimulation: dtoStimulation });

                stimulation.waitUntilComplete()
                    .then(() => {
                        this.enqueue({
                            type: 'stimulation.completed',
                            stimulationId: stimId,
                            completedAt: Date.now(),
                            hopCount: hopIndexes.get(stimulation) ?? 0,
                            hasError: false,
                        });
                        void this.flush();
                    })
                    .catch(() => {
                        this.enqueue({
                            type: 'stimulation.completed',
                            stimulationId: stimId,
                            completedAt: Date.now(),
                            hopCount: hopIndexes.get(stimulation) ?? 0,
                            hasError: true,
                        });
                        void this.flush();
                    });
            }

            const stimId = stimulationIds.get(stimulation)!;
            const hopIndex = hopIndexes.get(stimulation) ?? 0;
            hopIndexes.set(stimulation, hopIndex + 1);

            const inputCol = resp.inputSignal?.collateral as AnyCollateral | undefined;
            const outputCol = resp.outputSignal?.collateral as AnyCollateral | undefined;

            const inputCollateralId = inputCol
                ? this.resolveCollateralId(inputCol, cnsId, cns, registry)
                : this.resolveCollateralId(
                      (resp.outputSignal?.collateral ?? null) as AnyCollateral,
                      cnsId, cns, registry
                  );

            const outputCollateralId = outputCol
                ? this.resolveCollateralId(outputCol, cnsId, cns, registry)
                : null;

            const ownerNeuron = outputCol
                ? cns.network.getParentNeuronByCollateral(outputCol)
                : null;
            const neuronName = ownerNeuron
                ? (registry.getNeuronName(ownerNeuron as AnyNeuron) ?? null)
                : null;
            const neuronId = neuronName ? `${cnsId}:${neuronName}` : `${cnsId}:unknown`;

            const hop: CNSDTOHop = {
                id: `${stimId}:${hopIndex}`,
                stimulationId: stimId,
                index: hopIndex,
                neuronId,
                inputCollateralId,
                outputCollateralId,
                inputPayload: this.safeValue(resp.inputSignal?.payload ?? resp.outputSignal?.payload),
                outputPayload: outputCol ? this.safeValue(resp.outputSignal?.payload) : null,
                startedAt: Date.now(),
                duration: null,
                error: resp.error ? String(resp.error) : null,
            };

            this.enqueue({ type: 'stimulation.hop', hop });
            void this.flush();
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
        this.buffer.length = 0;
    }
}
