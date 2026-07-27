/** Optional bounds for a retry/clone action, mirroring `TCNSStimulationOptions`. */
export type TCNSStimulationActionOptions = {
    maxHops?: number;
    timeoutMs?: number;
    /** Restrict which neurons may fire, by name. */
    allowedNeuronNames?: string[];
};
