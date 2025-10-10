import { TCNSDevToolsOptions } from './types/TCNSDevToolsOptions';
import { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
import {
    CNS,
    CNSStimulationContextStore,
    TCNSDendrite,
    TCNSStimulationOptions,
} from '@cnstra/core';
import {
    InitMessage,
    StimulateCommand,
    Neuron,
    Collateral,
    Dendrite,
} from '@cnstra/devtools-dto';

export class CNSDevTools {
    private cns: CNS<any, any, any, any> | undefined;

    constructor(
        protected readonly appId: string,
        protected readonly transport: ICNSDevToolsTransport,
        protected options: TCNSDevToolsOptions
    ) {}

    /**
     * Register a CNS instance to this DevTools instance and emit init/topology.
     */
    registerCNS(cns: CNS<any, any, any, any>): void {
        if (this.cns) return; // already registered
        this.cns = cns;

        this.cns.addResponseListener(response => {
            const contexts = response.ctx?.getAll?.() || {};
            const safeInputPayload = this.safeJson(
                response.inputSignal?.payload
            );
            const safeOutputPayload = this.safeJson(
                response.outputSignal?.payload
            );
            const safeContexts = this.safeJson(contexts);

            // Get stimulation ID from the response
            const stimulationId =
                (response as any).stimulationId ||
                `${Date.now()}:${Math.random().toString(36).slice(2)}`;

            // Get neuron name from output signal's collateral owner, or from input signal
            let neuronId: string | null = null;
            let collateralName: string | null = null;

            if ((response.outputSignal as any)?.collateral) {
                collateralName = (response.outputSignal as any).collateral
                    ?.name;
                // Find the parent neuron for this collateral
                const parentNeuron =
                    this.cns!.getParentNeuronByCollateralName(collateralName);
                if (parentNeuron) {
                    neuronId = parentNeuron.name;
                }
            }

            // If still not found, try to identify from input signal or from collateral
            if (!neuronId) {
                let targetCollateralName = collateralName;

                // Get collateral name from input signal if available
                if ((response.inputSignal as any)?.collateral) {
                    targetCollateralName = (response.inputSignal as any)
                        .collateral?.name;
                    // Only set collateral name if we don't have one already
                    if (!collateralName) {
                        collateralName = targetCollateralName;
                    }
                }

                // Find neurons that listen to this collateral (dendrites)
                if (targetCollateralName) {
                    const neurons = this.cns!.getNeurons();
                    const processingNeuron = neurons.find(neuron =>
                        neuron.dendrites.some(
                            (dendrite: any) =>
                                dendrite.collateral?.name ===
                                targetCollateralName
                        )
                    );
                    if (processingNeuron) {
                        neuronId = processingNeuron.name;
                    }
                }
            }

            // Ensure we have all required data
            if (!neuronId) {
                // Fallback: attribute to app-level unknown neuron to avoid dropping telemetry
                neuronId = 'unknown';
            }

            if (!collateralName) {
                collateralName = 'unknown';
            }

            const appId =
                this.appId || this.options.devToolsInstanceId || 'cns-devtools';
            const cnsId =
                this.options.cnsId || this.options.devToolsInstanceId || appId;

            // Optional collateral names are currently not part of stable DTO typings in dist
            // Keep computed values for potential future use but do not send for type safety
            const inputCollateralName = (response.inputSignal as any)
                ?.collateral?.name;
            const outputCollateralName = (response.outputSignal as any)
                ?.collateral?.name;
            const hopIndex = (response as any).hopIndex as number | undefined;

            void this.transport.sendNeuronResponseMessage({
                stimulationId,
                neuronId: `${cnsId}:${neuronId}`,
                appId,
                collateralName,
                timestamp: Date.now(),
                payload: (safeInputPayload ?? undefined) as any,
                contexts: (safeContexts as any) || undefined,
                responsePayload: (safeOutputPayload ?? undefined) as any,
                error: (response.error as any) || undefined,
                duration: (response as any).duration || undefined,
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

            return {
                collateralName: collateral.name,
                neuronId: `${cnsId}:${parentNeuron.name}`,
                appId,
                cnsId,
                type: 'default',
            };
        });

        // Create Dendrite DTO objects
        const dendriteDTOs: Dendrite[] = neurons.flatMap(neuron => {
            return neuron.dendrites.map(
                (
                    dendrite: TCNSDendrite<any, any, any, any, any, any>,
                    index: number
                ) => ({
                    dendriteId:
                        `${cnsId}:${neuron.name}:d:${dendrite.collateral.name}`.replace(
                            /\s+/g,
                            '-'
                        ),
                    neuronId: `${cnsId}:${neuron.name}`,
                    appId,
                    cnsId,
                    collateralName: dendrite.collateral.name,
                    type: 'default',
                    collateralNames: [dendrite.collateral.name],
                })
            );
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
        } as any;

        console.log(
            '📤 DevTools sending init message:',
            JSON.stringify(initMessage, null, 2)
        );
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

        const ctx = new CNSStimulationContextStore();
        if (cmd.contexts) ctx.setAll(cmd.contexts);

        const options: TCNSStimulationOptions<any, any, any> = {
            stimulationId: cmd.stimulationCommandId,
        };
        if (cmd.options) {
            const src = cmd.options as any;
            if (src.maxNeuronHops) options.maxNeuronHops = src.maxNeuronHops;
            if (src.concurrency) options.concurrency = src.concurrency;
            if (src.allowedNames)
                options.allowName = t => src.allowedNames.includes(t as any);
            if (src.timeoutMs && typeof AbortController !== 'undefined') {
                const ac = new AbortController();
                setTimeout(() => ac.abort(), src.timeoutMs as number);
                options.abortSignal = ac.signal;
            }
        }
        options.ctx = ctx;

        const signal = (collateral as any).createSignal(cmd.payload);
        this.cns.stimulate(signal, options as any);
    }
}

export type { ICNSDevToolsTransport } from './interfaces/ICNSDevToolsTransport';
export type { TCNSDevToolsOptions } from './types/TCNSDevToolsOptions';
export type {
    InitMessage,
    NeuronResponseMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
} from '@cnstra/devtools-dto';
