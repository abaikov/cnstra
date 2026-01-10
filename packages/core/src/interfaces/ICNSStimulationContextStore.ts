export interface ICNSStimulationContextStore {
    get: (key: object) => unknown;
    set: (key: object, value: unknown) => void;
    getAll: () => Map<object, unknown>; // Snapshot for reuse in-process (no serialization)
    setAll: (values: Map<object, unknown>) => void; // Restore snapshot in-process
    delete: (key: object) => void;
}
