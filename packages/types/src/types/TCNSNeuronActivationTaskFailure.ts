import { TCNSNeuronActivationTask } from './TCNSNeuronActivationTask';

export type TCNSNeuronActivationTaskFailure<
    TNeuron extends object = object
> = {
    task: TCNSNeuronActivationTask<TNeuron>;
    error: Error;
    aborted: boolean;
};
