import type {
    ICNSStimulation,
    ICNSStimulationContextStore,
    TCNSNeuronActivationTask,
} from '@cnstra/types';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import { CNSStimulationContextStore } from './CNSStimulationContextStore';
import type { TCNSProgress, TCNSSerializedTask } from '@cnstra/persist-dto';

/**
 * Turns CNStra's in-memory frontier (live neuron/collateral object references plus
 * a `Map<object, unknown>` context) into a JSON-safe {@link TCNSProgress} keyed by
 * **registry names**, and back. Names are the only thing stable across a process
 * boundary — that is why resume needs the registry.
 *
 * Bind it to a registry once, then `serialize()` a stimulation's current outstanding
 * frontier and `hydrate()` a stored progress record into `{ tasks, ctx }` for
 * `cns.activate(...)`. The `cns` itself is the caller's — the serializer never needs it.
 */
export class CNSProgressSerializer {
    constructor(private readonly registry: CNSPersistOptionsRegistry) {}

    /** Snapshot a stimulation's current outstanding frontier + context. */
    serialize(stimulation: ICNSStimulation<any>): TCNSProgress {
        return {
            tasks: this.serializeTasks(stimulation.getOutstandingTasks()),
            context: this.serializeContext(stimulation.getContext().getAll()),
        };
    }

    /** Rebuild `{ tasks, ctx }` to pass straight into `cns.activate(tasks, { ctx })`. */
    hydrate(progress: TCNSProgress): {
        tasks: TCNSNeuronActivationTask<any>[];
        ctx: ICNSStimulationContextStore;
    } {
        return {
            tasks: this.hydrateTasks(progress.tasks),
            ctx: this.hydrateContext(progress.context),
        };
    }

    private requireName(name: string | undefined, what: string): string {
        if (!name) {
            throw new Error(
                `[@cnstra/persist] Cannot serialize progress: ${what} is not ` +
                    `registered in the CNSPersistOptionsRegistry. To enable resume, ` +
                    `register every neuron and collateral that can appear in the ` +
                    `outstanding frontier — not just the entry collaterals.`
            );
        }
        return name;
    }

    private serializeTasks(
        tasks: ReadonlyArray<TCNSNeuronActivationTask>
    ): TCNSSerializedTask[] {
        return tasks.map(task => {
            const neuronName = this.requireName(
                this.registry.getNeuronName(task.neuron as never),
                'a frontier neuron'
            );
            const dendriteCollateralName = this.requireName(
                this.registry.getCollateralName(task.dendriteCollateral),
                'a dendrite collateral'
            );
            const input = task.input
                ? {
                      collateralName: this.requireName(
                          this.registry.getCollateralName(task.input.collateral),
                          'an input collateral'
                      ),
                      payload: task.input.payload,
                  }
                : undefined;
            return { neuronName, dendriteCollateralName, input };
        });
    }

    private serializeContext(ctx: Map<object, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [neuron, value] of ctx) {
            const name = this.registry.getNeuronName(neuron as never);
            // Unregistered context keys can't be restored by name; skip them
            // rather than fail — a missing key just means the resumed neuron
            // starts from its own default.
            if (name) out[name] = value;
        }
        return out;
    }

    private hydrateTasks(
        serialized: ReadonlyArray<TCNSSerializedTask>
    ): TCNSNeuronActivationTask<any>[] {
        return serialized.map(s => {
            const neuron = this.registry.getNeuron(s.neuronName);
            if (!neuron) {
                throw new Error(
                    `[@cnstra/persist] Cannot hydrate: neuron "${s.neuronName}" ` +
                        `is not in the registry (mismatch between save and resume).`
                );
            }
            const dendriteCollateral = this.registry.getCollateral(
                s.dendriteCollateralName
            );
            if (!dendriteCollateral) {
                throw new Error(
                    `[@cnstra/persist] Cannot hydrate: collateral ` +
                        `"${s.dendriteCollateralName}" is not in the registry.`
                );
            }
            let input: TCNSNeuronActivationTask['input'];
            if (s.input) {
                const inputCollateral = this.registry.getCollateral(
                    s.input.collateralName
                );
                if (!inputCollateral) {
                    throw new Error(
                        `[@cnstra/persist] Cannot hydrate: input collateral ` +
                            `"${s.input.collateralName}" is not in the registry.`
                    );
                }
                input = inputCollateral.createSignal(
                    s.input.payload as never
                ) as TCNSNeuronActivationTask['input'];
            }
            return {
                neuron,
                dendriteCollateral,
                input,
            } as unknown as TCNSNeuronActivationTask;
        });
    }

    private hydrateContext(
        record: Record<string, unknown>
    ): CNSStimulationContextStore {
        const map = new Map<object, unknown>();
        for (const [name, value] of Object.entries(record)) {
            const neuron = this.registry.getNeuron(name);
            if (neuron) map.set(neuron as object, value);
        }
        return new CNSStimulationContextStore(map);
    }
}
