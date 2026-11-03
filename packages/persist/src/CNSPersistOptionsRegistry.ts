import type { ICNSCollateral } from '@cnstra/types';
import { TCNSAxon } from '@cnstra/types';
import { TCNSNeuron } from '@cnstra/types';
import type { TCNSAfferentPath, TCNSModality } from '@cnstra/types';
import type { TCNSCollateralNameMap } from './types/TCNSCollateralNameMap';

export class CNSPersistOptionsRegistry {
    private neurons = new Map<string, TCNSNeuron<TCNSAxon>>();
    private neuronNames = new WeakMap<TCNSNeuron<TCNSAxon>, string>();

    private collaterals = new Map<string, ICNSCollateral<unknown>>();
    /**
     * Name lookup by identity, matching `neuronNames` above. Not a scan over
     * `collaterals`: this is called several times per hop — by the persistor, the
     * devtools logger, the tracer, the serializer — to recover a string that was
     * known at registration.
     */
    private collateralNames = new WeakMap<ICNSCollateral<unknown>, string>();

    private modalities = new Map<string, TCNSModality>();
    private modalityNames = new WeakMap<TCNSModality, string>();

    private checkName<TValue extends object>(
        kind: string,
        name: string,
        value: TValue,
        values: Map<string, TValue>,
        names: WeakMap<TValue, string>
    ): void {
        const named = values.get(name);
        if (named !== undefined && named !== value)
            throw new Error(`cannot register a ${kind} as "${name}": another ${kind} has this name`);
        const knownName = names.get(value);
        if (knownName !== undefined && knownName !== name)
            throw new Error(`cannot register a ${kind} as "${name}": it is already registered as "${knownName}"`);
    }

    private bindName<TValue extends object>(
        kind: string,
        name: string,
        value: TValue,
        values: Map<string, TValue>,
        names: WeakMap<TValue, string>
    ): void {
        this.checkName(kind, name, value, values, names);
        values.set(name, value);
        names.set(value, name);
    }

    getNeuron(name: string): TCNSNeuron<TCNSAxon> | undefined {
        return this.neurons.get(name);
    }

    getNeuronName(neuron: TCNSNeuron<TCNSAxon>): string | undefined {
        return this.neuronNames.get(neuron);
    }

    getNamedNeurons(): ReadonlyMap<string, TCNSNeuron<TCNSAxon>> {
        return this.neurons;
    }

    getCollateralName(collateral: ICNSCollateral<unknown>): string | undefined {
        return this.collateralNames.get(collateral);
    }

    getCollateral(name: string): ICNSCollateral<unknown> | undefined {
        return this.collaterals.get(name);
    }

    register<TAxon extends TCNSAxon>(
        name: string,
        neuron: TCNSNeuron<TAxon>,
        collateralNames?: TCNSCollateralNameMap<TAxon>
    ): this {
        const explicitNames = (collateralNames ?? {}) as Record<string, string | undefined>;
        for (const key of Object.keys(explicitNames))
            if (!(key in neuron.axon))
                throw new Error(`cannot name collateral "${key}" of neuron "${name}": its axon has no such key`);
        const axonNames = Object.entries(neuron.axon).map(
            ([key, collateral]) => [explicitNames[key] ?? `${name}.${key}`, collateral as ICNSCollateral<unknown>] as const
        );
        this.checkName('neuron', name, neuron as unknown as TCNSNeuron<TCNSAxon>, this.neurons, this.neuronNames);
        const seenNames = new Set<string>();
        const seenCollaterals = new Set<ICNSCollateral<unknown>>();
        for (const [collateralName, collateral] of axonNames) {
            if (seenNames.has(collateralName) || seenCollaterals.has(collateral))
                throw new Error(`cannot register neuron "${name}": two of its collaterals share "${collateralName}" or one collateral has two names`);
            seenNames.add(collateralName);
            seenCollaterals.add(collateral);
            this.checkName('collateral', collateralName, collateral, this.collaterals, this.collateralNames);
        }
        this.bindName('neuron', name, neuron as unknown as TCNSNeuron<TCNSAxon>, this.neurons, this.neuronNames);
        for (const [collateralName, collateral] of axonNames) this.registerCollateral(collateralName, collateral);
        return this;
    }

    registerCollateral(name: string, collateral: ICNSCollateral<unknown>): this {
        this.bindName('collateral', name, collateral, this.collaterals, this.collateralNames);
        return this;
    }

    registerModality(name: string, modality: TCNSModality): this {
        this.bindName('modality', name, modality, this.modalities, this.modalityNames);
        return this;
    }

    getModality(name: string): TCNSModality | undefined {
        return this.modalities.get(name);
    }

    getModalityName(modality: TCNSModality): string | undefined {
        return this.modalityNames.get(modality);
    }

    getAfferentPathName(modality: TCNSModality, afferentPath: TCNSAfferentPath): string | undefined {
        for (const afferentPathName in modality.afferentPaths) {
            if (modality.afferentPaths[afferentPathName] === afferentPath) return afferentPathName;
        }
        return undefined;
    }

    getAfferentPath(modality: TCNSModality, afferentPathName: string): TCNSAfferentPath | undefined {
        return modality.afferentPaths[afferentPathName];
    }
}
