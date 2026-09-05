import type {
    ICNSStimulation,
    TCNSNeuronActivationTask,
} from '@cnstra/types';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import type { TCNSProgress, TCNSPlannedTaskJSON } from '@cnstra/persist-dto';

/**
 * Turns CNStra's in-memory frontier (live neuron/collateral object references)
 * into a JSON-safe {@link TCNSProgress} keyed by **registry names**, and back.
 * Names are the only thing stable across a process boundary — that is why resume
 * needs the registry.
 *
 * Bind it to a registry once, then `serialize()` a stimulation's current outstanding
 * frontier and `hydrate()` a stored progress record into `{ tasks }` for
 * `cns.activate(tasks)`. The `cns` itself is the caller's — the serializer never
 * needs it. Each task carries its own input signal (with payload), so re-driving
 * the frontier needs no extra state.
 */
export class CNSProgressSerializer {
    constructor(private readonly registry: CNSPersistOptionsRegistry) {}

    /** Snapshot a stimulation's current outstanding frontier. */
    serialize(stimulation: ICNSStimulation<any>): TCNSProgress {
        return {
            tasks: this.serializeTasks(stimulation.getOutstandingTasks()),
        };
    }

    /** Rebuild `{ tasks }` to pass straight into `cns.activate(tasks)`. */
    hydrate(progress: TCNSProgress): {
        tasks: TCNSNeuronActivationTask<any>[];
    } {
        return {
            tasks: this.hydrateTasks(progress.tasks),
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
    ): TCNSPlannedTaskJSON[] {
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

    private hydrateTasks(
        serialized: ReadonlyArray<TCNSPlannedTaskJSON>
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
}
