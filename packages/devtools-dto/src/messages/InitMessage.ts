import { DevToolsAppId } from '../entities/DevToolsApp';
import { Neuron } from '../entities/Neuron';
import { Collateral } from '../entities/Collateral';
import { Dendrite } from '../entities/Dendrite';

export interface InitMessage {
    type: 'init';
    /** Application identifier (human/system-defined) */
    appId: DevToolsAppId;
    /** CNS instance identifier, globally unique (e.g. `${appId}:${cnsName}`) */
    cnsId: string;
    /** Optional legacy field kept for compatibility; not used by new clients */
    devToolsInstanceId?: DevToolsAppId;
    appName: string;
    version?: string;
    timestamp: number;
    neurons: Neuron[];
    collaterals: Collateral[];
    dendrites: Dendrite[];
}
