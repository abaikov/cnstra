import type { ICNSStimulation } from '@cnstra/types';
import type { ICNSCollateral } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import {
    TCNSCollateralPersistOptions,
    TCNSNeuronPersistOptions,
    TCNSStimulationPersistOptions,
} from '@cnstra/types';

export class CNSPersistOptionsRegistry {
    private neurons = new Map<string, TCNSNeuron<unknown, TCNSAxon>>();
    private neuronNames = new WeakMap<TCNSNeuron<unknown, TCNSAxon>, string>();

    private collaterals = new Map<string, ICNSCollateral<unknown>>();

    private stimulations = new Map<
        string,
        ICNSStimulation<TCNSNeuron<unknown, TCNSAxon>>
    >();

    addNeuron(
        neuron: TCNSNeuron<unknown, TCNSAxon>,
        options: TCNSNeuronPersistOptions<TCNSNeuron<unknown, TCNSAxon>>
    ): void {
        this.neurons.set(options.name, neuron);
        this.neuronNames.set(neuron, options.name);
    }

    getNeuron(name: string): TCNSNeuron<unknown, TCNSAxon> | undefined {
        return this.neurons.get(name);
    }

    getNeuronName(neuron: TCNSNeuron<unknown, TCNSAxon>): string | undefined {
        return this.neuronNames.get(neuron);
    }

    getNamedNeurons(): ReadonlyMap<string, TCNSNeuron<unknown, TCNSAxon>> {
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
        stimulation: ICNSStimulation<TCNSNeuron<unknown, TCNSAxon>>,
        options: TCNSStimulationPersistOptions
    ): void {
        this.stimulations.set(options.stimulationId, stimulation);
    }

    getStimulation(
        stimulationId: string
    ): ICNSStimulation<TCNSNeuron<unknown, TCNSAxon>> | undefined {
        return this.stimulations.get(stimulationId);
    }

    removeStimulation(stimulationId: string): void {
        this.stimulations.delete(stimulationId);
    }

    register<TAxon extends TCNSAxon>(
        name: string,
        neuron: TCNSNeuron<any, TAxon>,
        collateralNames?: { [K in keyof TAxon]?: string }
    ): this {
        this.addNeuron(neuron as unknown as TCNSNeuron<unknown, TCNSAxon>, { name, neuron: neuron as unknown as TCNSNeuron<unknown, TCNSAxon> });
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
