import { CNSCollateral } from './CNSCollateral';
import { CNSStimulation } from './CNSStimulation';
import { TCNSAxon } from './types/TCNSAxon';
import { TCNSNeuron } from './types/TCNSNeuron';
import {
    TCNSCollateralPersistOptions,
    TCNSNeuronPersistOptions,
    TCNSStimulationPersistOptions,
} from './types/TCNSPersist';

export class CNSPersistOptionsRegistry {
    private neurons = new Map<string, TCNSNeuron<unknown, TCNSAxon>>();
    private neuronNames = new WeakMap<TCNSNeuron<unknown, TCNSAxon>, string>();

    private collaterals = new Map<string, CNSCollateral<unknown>>();

    private stimulations = new Map<
        string,
        CNSStimulation<TCNSNeuron<unknown, TCNSAxon>>
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

    removeNeuron(name: string): void {
        const neuron = this.neurons.get(name);
        if (neuron) this.neuronNames.delete(neuron);
        this.neurons.delete(name);
    }

    addCollateral(
        collateral: CNSCollateral<unknown>,
        options: TCNSCollateralPersistOptions
    ): void {
        this.collaterals.set(options.name, collateral);
    }

    getCollateral(name: string): CNSCollateral<unknown> | undefined {
        return this.collaterals.get(name);
    }

    removeCollateral(name: string): void {
        this.collaterals.delete(name);
    }

    addStimulation(
        stimulation: CNSStimulation<TCNSNeuron<unknown, TCNSAxon>>,
        options: TCNSStimulationPersistOptions
    ): void {
        this.stimulations.set(options.stimulationId, stimulation);
    }

    getStimulation(
        stimulationId: string
    ): CNSStimulation<TCNSNeuron<unknown, TCNSAxon>> | undefined {
        return this.stimulations.get(stimulationId);
    }

    removeStimulation(stimulationId: string): void {
        this.stimulations.delete(stimulationId);
    }
}
