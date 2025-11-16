import { TCNSStimulationSerializedContextValue } from '../types/TCNSStimulationSerializedContextValue';

export interface ICNSStimulationContextStore {
    get: (key: string) => unknown;
    set: (key: string, value: unknown) => void;
    getAll: () => TCNSStimulationSerializedContextValue; // Get all context values for recovery
    setAll: (values: TCNSStimulationSerializedContextValue) => void; // Set all context values for recovery
    delete: (key: string) => void;
}
