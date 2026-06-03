import { TCNSDevToolsOptions } from './types/TCNSDevToolsOptions';
import { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
import { CNSStimulationContextStore } from '@cnstra/core';
import {
    InitMessage,
    StimulateCommand,
    Neuron,
    Collateral,
    Dendrite,
    StimulationMessage,
} from '@cnstra/devtools-dto';

/** Minimal interface for CNS instances that CNSDevTools needs to interact with */
interface ICNSForDevTools {
    addResponseListener(listener: (response: unknown) => void): void;
    getNeurons(): Array<{ name: string; axon?: Record<string, unknown>; dendrites: Array<{ collateral: { name: string } }> }>;
    getCollaterals(): Array<{ name: string; createSignal(payload: unknown): unknown }>;
    stimulate(signal: unknown, options: Record<string, unknown>): void;
}

/** Options passed to CNS.stimulate */
interface ICNSStimulateOptions {
    stimulationId?: string;
    maxNeuronHops?: number;
    concurrency?: number;
    allowName?: (name: unknown) => boolean;
    abortSignal?: AbortSignal;
    ctx?: CNSStimulationContextStore;
}

export class CNSDevTools {
    private cns: ICNSForDevTools | undefined;

    constructor(
        protected readonly appId: string,
        protected readonly transport: ICNSDevToolsTransport,
        protected options: TCNSDevToolsOptions
    ) {}

    /**
     * Register a CNS instance to this DevTools instance and emit init/topology.
     */
    registerCNS(cns: ICNSForDevTools, cnsName: string): void {
        if (this.cns) return; // already registered
        this.cns = cns;

        this.cns.addResponseListener((response: unknown) => {
            const resp = response as {
                inputSignal?: { payload?: unknown; collateralName?: string };
                outputSignal?: { payload?: unknown; collateralName?: string };
                ctx?: { getAll?: () => Record<string, unknown> };
                stimulationId?: string;
                hopIndex?: number;
                duration?: number;
                error?: unknown;
            };
            const contexts = resp.ctx?.getAll?.() || {};
            const safeInputPayload = this.safeJson(resp.inputSignal?.payload);
            const safeOutputPayload = this.safeJson(resp.outputSignal?.payload);
            const safeContexts = this.safeJson(contexts);

            // Get stimulation ID from the response
            // For replays, the stimulationId should come from the CNS stimulation options
            // which we set in handleStimulate as cmd.stimulationCommandId
            const stimulationIdFromResponse = resp.stimulationId;

            // inputSignal is optional - if not present, this is initial stimulation
            // For initial stimulation, use outputSignal's collateralName as inputCollateralName
            // This ensures inputCollateralName is always present (required field)
            const inputCollateralName =
                resp.inputSignal?.collateralName ||
                resp.outputSignal?.collateralName ||
                'unknown';

            const outputCollateralName = resp.outputSignal?.collateralName;

            const appId =
                this.appId || this.options.devToolsInstanceId || 'cns-devtools';

            const cnsId =
                this.options.cnsId ||
                `${appId}:${this.options.devToolsInstanceName || 'cns'}`;

            // Derive neuronId from the output collateral's parent neuron
            let neuronId: string | undefined;
            try {
                const neurons = this.cns!.getNeurons();
                const collateralLookupName =
                    outputCollateralName || inputCollateralName;
                if (collateralLookupName && collateralLookupName !== 'unknown') {
                    const parentNeuron = neurons.find(neuron => {
                        const axonKeys = Object.keys(neuron.axon || {});
                        const camelCase = collateralLookupName.replace(
                            /-([a-z])/g,
                            (_: string, l: string) => l.toUpperCase()
                        );
                        const kebabCase = collateralLookupName
                            .replace(/([A-Z])/g, '-$1')
                            .toLowerCase();
                        return (
                            axonKeys.includes(collateralLookupName) ||
                            axonKeys.includes(camelCase) ||
                            axonKeys.includes(kebabCase)
                        );
                    });
                    if (parentNeuron) {
                        neuronId = `${cnsId}:${parentNeuron.name}`;
                    }
                }
            } catch {
                // ignore - neuronId is optional
            }

            const stimulationId =
                stimulationIdFromResponse ||
                `${Date.now()}:${Math.random().toString(36).slice(2)}`;

            if (this.options.consoleLogEnabled) {
                if (!stimulationIdFromResponse) {
                    console.warn('[DevTools] Response missing stimulationId!', {
                        responseKeys: Object.keys(resp || {}),
                        hasStimulationId: 'stimulationId' in (resp || {}),
                        responseType: typeof resp,
                    });
                } else if (stimulationIdFromResponse.includes('-replay-')) {
                    console.log('[DevTools] Processing REPLAY response:', {
                        stimulationId: stimulationIdFromResponse,
                        appId,
                        inputCollateralName,
                        outputCollateralName,
                    });
                }
            }

            const responseId = `${appId}:resp:${stimulationId}:${Date.now()}`;

            if (this.options.consoleLogEnabled) {
                try {
                    console.log(
                        '🧠 DevTools response:',
                        JSON.stringify(
                            {
                                stimulationId,
                                inputCollateralName,
                                outputCollateralName,
                                inputPayload: safeInputPayload,
                                outputPayload: safeOutputPayload,
                                contexts: safeContexts,
                                hopIndex: resp.hopIndex,
                                duration: resp.duration,
                                error: resp.error ? String(resp.error) : undefined,
                            },
                            null,
                            2
                        )
                    );
                } catch {}
            }

            void this.transport.sendNeuronResponseMessage({
                responseId,
                stimulationId,
                appId,
                cnsId,
                neuronId,
                timestamp: Date.now(),
                inputCollateralName,
                outputCollateralName,
                inputPayload: safeInputPayload as unknown,
                outputPayload: safeOutputPayload as unknown,
                contexts: (safeContexts as Record<string, unknown>) || undefined,
                error: resp.error ? String(resp.error) : undefined,
                duration: resp.duration || undefined,
                hopIndex: resp.hopIndex,
            });
        });

        this.sendInitMessage(this.transport);
        if (this.transport.onStimulateCommand) {
            this.transport.onStimulateCommand(cmd => this.handleStimulate(cmd));
        }
    }

    private sendInitMessage(transport: ICNSDevToolsTransport): Promise<void> {
        if (!this.cns) throw new Error('CNS is not registered');
        const neurons = this.cns.getNeurons();
        const collaterals = this.cns.getCollaterals();
        const appId =
            this.appId || this.options.devToolsInstanceId || 'cns-app';
        // Prefer provided cnsId; else derive from appId + name for multi-CNS support
        const cnsId =
            this.options.cnsId ||
            `${appId}:${this.options.devToolsInstanceName || 'cns'}`;

        // Create Neuron DTO objects
        const neuronDTOs: Neuron[] = neurons.map(neuron => ({
            id: `${cnsId}:${neuron.name}`,
            appId,
            cnsId,
            name: neuron.name,
        }));

        // Create Collateral DTO objects
        const collateralDTOs: Collateral[] = collaterals.map(collateral => {
            // Find the parent neuron for this collateral by checking axon keys
            // Need to handle case conversion between kebab-case collateral names and camelCase axon keys
            const parentNeuron = neurons.find(neuron => {
                const neuronAxonKeys = Object.keys(neuron.axon || {});

                // Try direct match first
                if (neuronAxonKeys.includes(collateral.name)) {
                    return true;
                }

                // Try converting kebab-case to camelCase
                const camelCaseName = collateral.name.replace(
                    /-([a-z])/g,
                    (_: string, letter: string) => letter.toUpperCase()
                );
                if (neuronAxonKeys.includes(camelCaseName)) {
                    return true;
                }

                // Try converting camelCase to kebab-case
                const kebabCaseName = collateral.name
                    .replace(/([A-Z])/g, '-$1')
                    .toLowerCase();
                if (neuronAxonKeys.includes(kebabCaseName)) {
                    return true;
                }

                return false;
            });

            if (!parentNeuron) {
                const availableAxonKeys = neurons.flatMap(n =>
                    Object.keys(n.axon || {})
                );
                throw new Error(
                    `Unable to find parent neuron for collateral "${collateral.name}". ` +
                        `Available axon keys: [${availableAxonKeys.join(
                            ', '
                        )}]. ` +
                        `This indicates a mismatch between collateral names and neuron axon definitions.`
                );
            }

            const neuronId = `${cnsId}:${parentNeuron.name}`;
            return {
                id: `${neuronId}:${collateral.name}`,
                name: collateral.name,
                neuronId,
                appId,
                cnsId,
            };
        });

        // Create Dendrite DTO objects
        const dendriteDTOs: Dendrite[] = neurons.flatMap(neuron => {
            return neuron.dendrites.map(dendrite => {
                const neuronId = `${cnsId}:${neuron.name}`;
                return {
                    id: `${neuronId}:d:${dendrite.collateral.name}`.replace(
                        /\s+/g,
                        '-'
                    ),
                    neuronId,
                    appId,
                    cnsId,
                    name: dendrite.collateral.name,
                };
            });
        });

        const initMessage: InitMessage = {
            type: 'init',
            appId,
            cnsId,
            appName: this.options.devToolsInstanceName || 'CNS',
            version: '0.0.1',
            timestamp: Date.now(),
            neurons: neuronDTOs,
            collaterals: collateralDTOs,
            dendrites: dendriteDTOs,
        };

        if (this.options.consoleLogEnabled) {
            try {
                console.log(
                    '📤 DevTools sending init message:',
                    JSON.stringify(initMessage, null, 2)
                );
            } catch {}
        }
        return transport.sendInitMessage(initMessage);
    }

    private safeJson(value: unknown, seen = new WeakSet<object>()): unknown {
        if (value === null) return null;
        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        )
            return value;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'undefined') return undefined;
        if (typeof value === 'function') return `[Function]`;
        if (typeof value === 'symbol') return String(value);
        if (value instanceof Error)
            return {
                name: value.name,
                message: value.message,
                stack: value.stack,
            };
        if (Array.isArray(value)) return value.map(v => this.safeJson(v, seen));
        if (typeof value === 'object') {
            if (!value) return value;
            if (seen.has(value as object)) return '[Circular]';
            seen.add(value as object);
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(
                value as Record<string, unknown>
            )) {
                const sv = this.safeJson(v, seen);
                if (sv !== undefined) out[k] = sv;
            }
            return out;
        }
        return value;
    }

    private handleStimulate(cmd: StimulateCommand): void {
        if (!this.cns) return;
        const collaterals = this.cns.getCollaterals();
        const collateral = collaterals.find(c => c.name === cmd.collateralName);
        if (!collateral) {
            // nothing to do; optional rejection can be sent by transport before calling here
            return;
        }

        if (this.options.consoleLogEnabled) {
            try {
                console.log(
                    '⚡ DevTools stimulate command:',
                    JSON.stringify(cmd, null, 2)
                );
            } catch {}
        }

        const ctx = new CNSStimulationContextStore();
        if (cmd.contexts) {
            ctx.setAll(
                new Map(
                    Object.entries(cmd.contexts).map(([key, value]) => [
                        { name: key },
                        value,
                    ])
                )
            );
        }

        const options: ICNSStimulateOptions = {
            stimulationId: cmd.stimulationCommandId,
        };

        if (this.options.consoleLogEnabled && cmd.stimulationCommandId.includes('-replay-')) {
            console.log('[DevTools] Setting stimulationId in options:', {
                stimulationCommandId: cmd.stimulationCommandId,
                optionsStimulationId: options.stimulationId,
                willBeReplay: options.stimulationId?.includes('-replay-'),
            });
        }
        if (cmd.options) {
            const src = cmd.options as {
                maxNeuronHops?: number;
                concurrency?: number;
                allowedNames?: string[];
                timeoutMs?: number;
            };
            if (src.maxNeuronHops) options.maxNeuronHops = src.maxNeuronHops;
            if (src.concurrency) options.concurrency = src.concurrency;
            if (src.allowedNames)
                options.allowName = (t: unknown) =>
                    src.allowedNames!.includes(t as string);
            if (src.timeoutMs && typeof AbortController !== 'undefined') {
                const ac = new AbortController();
                setTimeout(() => ac.abort(), src.timeoutMs);
                options.abortSignal = ac.signal;
            }
        }
        options.ctx = ctx;

        // Send initial stimulation message for replay tracking
        try {
            const stimNeurons = this.cns.getNeurons();
            const appId =
                this.appId || this.options.devToolsInstanceId || 'cns-devtools';
            const cnsId =
                this.options.cnsId ||
                `${appId}:${this.options.devToolsInstanceName || 'cns'}`;

            // Find the parent neuron for this collateral
            const parentNeuron = stimNeurons.find(neuron => {
                const neuronAxonKeys = Object.keys(neuron.axon || {});

                // Try direct match first
                if (neuronAxonKeys.includes(cmd.collateralName)) {
                    return true;
                }

                // Try converting kebab-case to camelCase
                const camelCaseName = cmd.collateralName.replace(
                    /-([a-z])/g,
                    (_: string, letter: string) => letter.toUpperCase()
                );
                if (neuronAxonKeys.includes(camelCaseName)) {
                    return true;
                }

                // Try converting camelCase to kebab-case
                const kebabCaseName = cmd.collateralName
                    .replace(/([A-Z])/g, '-$1')
                    .toLowerCase();
                if (neuronAxonKeys.includes(kebabCaseName)) {
                    return true;
                }

                return false;
            });

            if (parentNeuron && this.transport.sendStimulationMessage) {
                const neuronId = `${cnsId}:${parentNeuron.name}`;
                const stimulationMessage: StimulationMessage = {
                    type: 'stimulation',
                    stimulationId: cmd.stimulationCommandId,
                    appId,
                    cnsId,
                    neuronId,
                    collateralName: cmd.collateralName,
                    timestamp: Date.now(),
                    payload: this.safeJson(cmd.payload),
                    queueLength: 0,
                    hops: 0,
                };
                void this.transport.sendStimulationMessage(stimulationMessage);
            }
        } catch (e) {
            // Ignore errors when sending stimulation message
            if (this.options.consoleLogEnabled) {
                console.warn('Failed to send initial stimulation message:', e);
            }
        }

        const signal = collateral.createSignal(cmd.payload);

        // Debug log for replay commands
        if (this.options.consoleLogEnabled) {
            console.log('🔁 [DevTools] Executing replay stimulation:', {
                stimulationCommandId: cmd.stimulationCommandId,
                stimulationId: options.stimulationId,
                collateralName: cmd.collateralName,
                appId: this.appId || this.options.devToolsInstanceId,
            });
        }

        this.cns.stimulate(signal, options as Record<string, unknown>);
    }
}

export { dumpCNSGraph, CNSHistoryLogger } from './inspect';
export type { CNSHistoryLoggerOptions } from './inspect';

export type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
export type { TCNSDevToolsOptions } from './types/TCNSDevToolsOptions';
export type {
    InitMessage,
    NeuronResponseMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';
