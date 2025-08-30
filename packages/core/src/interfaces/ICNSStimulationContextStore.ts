export interface ICNSStimulationContextStore {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    getAll: () => Record<string, unknown>; // Get all context values for recovery
}
