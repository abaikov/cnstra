import type {
    ICNSStimulation,
    TCNSAfferentPath,
    TCNSModality,
    TCNSNeuronActivationTask,
} from '@cnstra/types';
import { CNSPersistOptionsRegistry } from './CNSPersistOptionsRegistry';
import { portable } from './portable';
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

    /**
     * Snapshot a stimulation's current outstanding frontier, plus the context
     * stores riding on the run and on each frontier task.
     *
     * Only the portable part of a store is taken — see {@link portable}. A live
     * handle cannot be rebuilt on the far side, so carrying it would be a lie.
     */
    serialize(stimulation: ICNSStimulation<any>): TCNSProgress {
        const options = (stimulation as {
            options?: { stimulationContext?: unknown; modality?: TCNSModality; afferentPath?: TCNSAfferentPath };
        }).options;
        const stimulationContext = portable(options?.stimulationContext) as Record<string, unknown> | undefined;
        const modality = options?.modality;

        return {
            tasks: this.serializeTasks(stimulation.getOutstandingTasks()),
            ...(stimulationContext && Object.keys(stimulationContext).length
                ? { stimulationContext }
                : {}),
            ...(modality !== undefined
                ? { modalityName: this.requireName(this.registry.getModalityName(modality), 'the stimulation modality') }
                : {}),
            ...(modality !== undefined && options?.afferentPath !== undefined
                ? { afferentPathName: this.requireName(this.registry.getAfferentPathName(modality, options.afferentPath), 'the stimulation afferent path') }
                : {}),
        };
    }

    /**
     * Rebuild what `cns.activate(...)` needs: the frontier tasks, each carrying
     * back its own store, and the run's store to pass as `stimulationContext`.
     *
     * ```ts
     * const { tasks, stimulationContext } = serializer.hydrate(saved);
     * cns.activate(tasks, { stimulationContext });
     * ```
     */
    hydrate(progress: TCNSProgress): {
        tasks: TCNSNeuronActivationTask<any>[];
        stimulationContext?: Record<string, unknown>;
        modality?: TCNSModality;
        afferentPath?: TCNSAfferentPath;
    } {
        const modality = progress.modalityName !== undefined ? this.hydrateModality(progress.modalityName) : undefined;
        return {
            tasks: this.hydrateTasks(progress.tasks),
            ...(progress.stimulationContext
                ? { stimulationContext: progress.stimulationContext }
                : {}),
            ...(modality !== undefined ? { modality } : {}),
            ...(modality !== undefined && progress.afferentPathName !== undefined
                ? { afferentPath: this.hydrateAfferentPath(modality, progress.modalityName!, progress.afferentPathName) }
                : {}),
        };
    }

    private hydrateModality(modalityName: string): TCNSModality {
        const modality = this.registry.getModality(modalityName);
        if (!modality) {
            throw new Error(
                `[@cnstra/persist] Cannot hydrate: modality "${modalityName}" is not in the registry.`
            );
        }
        return modality;
    }

    private hydrateAfferentPath(modality: TCNSModality, modalityName: string, afferentPathName: string): TCNSAfferentPath {
        const afferentPath = this.registry.getAfferentPath(modality, afferentPathName);
        if (!afferentPath) {
            throw new Error(
                `[@cnstra/persist] Cannot hydrate: afferent path "${afferentPathName}" is not in modality "${modalityName}".`
            );
        }
        return afferentPath;
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
            const activationContext = portable(task.activationContext) as
                | Record<string, unknown>
                | undefined;
            return {
                neuronName,
                dendriteCollateralName,
                input,
                ...(activationContext && Object.keys(activationContext).length
                    ? { activationContext }
                    : {}),
            };
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
                ...(s.activationContext
                    ? { activationContext: s.activationContext }
                    : {}),
            } as unknown as TCNSNeuronActivationTask;
        });
    }
}
