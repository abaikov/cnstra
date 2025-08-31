export type TCNSStimulationQueueItem<TNeuronId extends string> = {
    neuronId: TNeuronId;
    callback: () => (() => void) | Promise<() => void>;
};
