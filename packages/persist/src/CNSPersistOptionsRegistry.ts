import type { ICNSStimulation } from '@cnstra/types';
import type { ICNSCollateral } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import {
    TCNSCollateralPersistOptions,
    TCNSNeuronPersistOptions,
    TCNSStimulationPersistOptions,
} from '@cnstra/types';
import type { TCNSCollateralNameMap } from './types/TCNSCollateralNameMap';

export class CNSPersistOptionsRegistry {
    private neurons = new Map<string, TCNSNeuron<TCNSAxon>>();
    private neuronNames = new WeakMap<TCNSNeuron<TCNSAxon>, string>();

    private collaterals = new Map<string, ICNSCollateral<unknown>>();

    private stimulations = new Map<
        string,
        ICNSStimulation<TCNSNeuron<TCNSAxon>>
    >();

    addNeuron(
        neuron: TCNSNeuron<TCNSAxon>,
        options: TCNSNeuronPersistOptions<TCNSNeuron<TCNSAxon>>
    ): void {
        this.neurons.set(options.name, neuron);
        this.neuronNames.set(neuron, options.name);
    }

    getNeuron(name: string): TCNSNeuron<TCNSAxon> | undefined {
        return this.neurons.get(name);
    }

    getNeuronName(neuron: TCNSNeuron<TCNSAxon>): string | undefined {
        return this.neuronNames.get(neuron);
    }

    getNamedNeurons(): ReadonlyMap<string, TCNSNeuron<TCNSAxon>> {
        return this.neurons;
    }

    getCollateralName(collateral: ICNSCollateral<unknown>): string | undefined {
        for (const [name, col] of this.collaterals) {
            if (col === collateral) return name;
        }
        return undefined;
    }

    removeNeuron(name: string): void {
        const neuron = this.neurons.get(name);
        if (neuron) this.neuronNames.delete(neuron);
        this.neurons.delete(name);
    }

    addCollateral(
        collateral: ICNSCollateral<unknown>,
        options: TCNSCollateralPersistOptions
    ): void {
        this.collaterals.set(options.name, collateral);
    }

    getCollateral(name: string): ICNSCollateral<unknown> | undefined {
        return this.collaterals.get(name);
    }

    removeCollateral(name: string): void {
        this.collaterals.delete(name);
    }

    addStimulation(
        stimulation: ICNSStimulation<TCNSNeuron<TCNSAxon>>,
        options: TCNSStimulationPersistOptions
    ): void {
        this.stimulations.set(options.stimulationId, stimulation);
    }

    getStimulation(
        stimulationId: string
    ): ICNSStimulation<TCNSNeuron<TCNSAxon>> | undefined {
        return this.stimulations.get(stimulationId);
    }

    removeStimulation(stimulationId: string): void {
        this.stimulations.delete(stimulationId);
    }

    register<TAxon extends TCNSAxon>(
        name: string,
        neuron: TCNSNeuron<TAxon>,
        collateralNames?: TCNSCollateralNameMap<TAxon>
    ): this {
        this.addNeuron(neuron as unknown as TCNSNeuron<TCNSAxon>, { name, neuron: neuron as unknown as TCNSNeuron<TCNSAxon> });
        for (const [key, col] of Object.entries(neuron.axon)) {
            this.addCollateral(col as ICNSCollateral<unknown>, {
                name: (collateralNames as Record<string, string> | undefined)?.[key] ?? key,
                collateral: col as ICNSCollateral<unknown>,
            });
        }
        return this;
    }

    registerCollateral(name: string, collateral: ICNSCollateral<unknown>): this {
        this.addCollateral(collateral, { name, collateral });
        return this;
    }
}
