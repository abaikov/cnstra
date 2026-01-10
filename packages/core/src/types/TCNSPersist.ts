import { CNSCollateral } from '../CNSCollateral';
import { TCNSNeuron } from './TCNSNeuron';

type CNSCollateralLike = InstanceType<typeof CNSCollateral>;

export type TCNSNeuronPersistOptions<
    TNeuron extends TCNSNeuron<unknown, any> = TCNSNeuron<unknown, any>
> = {
    name: string;
    neuron: TNeuron;
};

export type TCNSCollateralPersistOptions<
    TCollateral extends CNSCollateralLike = CNSCollateralLike
> = {
    name: string;
    collateral: TCollateral;
};

export type TCNSStimulationPersistOptions = {
    stimulationId: string;
};
