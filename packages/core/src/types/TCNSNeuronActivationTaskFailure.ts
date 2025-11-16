import { TCNSNeuronActivationTask } from './TCNSNeuronActivationTask';

export type TCNSNeuronActivationTaskFailure<
    TCollateralName extends string = string,
    TNeuronName extends string = string
> = {
    task: TCNSNeuronActivationTask<TCollateralName, TNeuronName>;
    error: Error;
    aborted: boolean;
};
