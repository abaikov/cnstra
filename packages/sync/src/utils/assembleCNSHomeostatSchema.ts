import { createCNS } from '@cnstra/core';
import { CNSHomeostatForwardingCNS } from '../CNSHomeostatForwardingCNS';
import type { CNSHomeostatReceptor } from '../CNSHomeostatReceptor';
import { CNSHomeostatReceptorCorrection } from '../CNSHomeostatReceptorCorrection';
import type { ICNSHomeostatModelBinding } from '../interfaces/ICNSHomeostatModelBinding';
import type { ICNSHomeostatModelDefinition } from '../interfaces/ICNSHomeostatModelDefinition';
import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';
import type { TCNSHomeostatModels } from '../types/TCNSHomeostatModels';
import type { TCNSHomeostatNeuronDependencies } from '../types/TCNSHomeostatNeuronDependencies';
import type { TCNSHomeostatNeuronFactory } from '../types/TCNSHomeostatNeuronFactory';
import type { TCNSHomeostatNeurons } from '../types/TCNSHomeostatNeurons';
import type { TCNSHomeostatSchema } from '../types/TCNSHomeostatSchema';
import type { TCNSHomeostatSchemaOptions } from '../types/TCNSHomeostatSchemaOptions';

const CNS_HOMEOSTAT_SCHEMA_MEMBER_NAMES: readonly string[] = ['cns', 'homeostatEnvironment', 'homeostatNeurons', 'neurons', 'dispose'];

export function assembleCNSHomeostatSchema<
    THandles extends ICNSHomeostatModelHandles,
    TModels extends Record<string, ICNSHomeostatModelDefinition>,
    TNeurons extends Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>> = Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>>,
>(
    binding: ICNSHomeostatModelBinding<THandles>,
    options: TCNSHomeostatSchemaOptions<TModels, THandles, TNeurons>
): TCNSHomeostatSchema<TModels, THandles, TNeurons> {
    const forwardingCNS = new CNSHomeostatForwardingCNS();
    const homeostatEnvironment = binding.createEnvironment(forwardingCNS);
    const homeostatModelDefinitions: Record<string, ICNSHomeostatModelDefinition> = options.homeostatModels;
    const homeostatModelRecord: Record<string, unknown> = {};
    const homeostatDendritesByModelName = new Map<string, readonly unknown[]>();
    const createOwnerNeuronByModelName = new Map<string, () => ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>>();
    const homeostatReceptors = new Set<CNSHomeostatReceptor<never, unknown>>();
    for (const [modelName, homeostatModelDefinition] of Object.entries(homeostatModelDefinitions)) {
        if (CNS_HOMEOSTAT_SCHEMA_MEMBER_NAMES.includes(modelName)) {
            homeostatEnvironment.dispose();
            throw new Error(`assembleCNSHomeostatSchema: a homeostat model cannot be named "${modelName}"; the schema has a member of that name`);
        }
        const homeostatModel = homeostatModelDefinition.createModel(binding, homeostatEnvironment);
        homeostatModelRecord[modelName] = homeostatModel;
        homeostatDendritesByModelName.set(modelName, homeostatModel.homeostatDendrites);
        createOwnerNeuronByModelName.set(modelName, () => homeostatModel.createNeuron());
        for (const homeostatReceptor of homeostatModelDefinition.homeostatReceptors) homeostatReceptors.add(homeostatReceptor);
    }
    const homeostatModels = homeostatModelRecord as TCNSHomeostatModels<TModels, THandles>;
    const neuronFactories: Record<string, TCNSHomeostatNeuronFactory<TModels, THandles>> = options.neuronFactories ?? {};
    const neuronFactoryList = Object.values(neuronFactories);
    if (new Set(neuronFactoryList).size !== neuronFactoryList.length) {
        homeostatEnvironment.dispose();
        throw new Error('assembleCNSHomeostatSchema: a neuron factory is listed twice; every dendrite of its neuron would run twice');
    }
    const neuronDependencies: TCNSHomeostatNeuronDependencies<TModels, THandles> = { ...homeostatModels, homeostatEnvironment };
    const neuronRecord: Record<string, ReturnType<TCNSHomeostatNeuronFactory<TModels, THandles>>> = {};
    for (const [neuronName, createNeuron] of Object.entries(neuronFactories)) neuronRecord[neuronName] = createNeuron(neuronDependencies);
    if (options.neuronFactories === undefined) {
        for (const [modelName, homeostatDendrites] of homeostatDendritesByModelName) {
            const createOwnerNeuron = createOwnerNeuronByModelName.get(modelName);
            if (homeostatDendrites.length > 0 && createOwnerNeuron !== undefined) neuronRecord[`${modelName}Neuron`] = createOwnerNeuron();
        }
    }
    const userNeurons = Object.values(neuronRecord);
    for (const [modelName, homeostatDendrites] of homeostatDendritesByModelName) {
        if (homeostatDendrites.length === 0) continue;
        const ownerNeurons = userNeurons.filter(userNeuron => userNeuron.dendrites.some(dendrite => homeostatDendrites.includes(dendrite)));
        const ownerNeuron = ownerNeurons[0];
        const isAttachedOnce = ownerNeurons.length === 1 && ownerNeuron !== undefined
            && homeostatDendrites.every(homeostatDendrite => ownerNeuron.dendrites.filter(dendrite => dendrite === homeostatDendrite).length === 1);
        if (!isAttachedOnce) {
            homeostatEnvironment.dispose();
            throw new Error(
                `assembleCNSHomeostatSchema: the homeostatDendrites of the homeostat model "${modelName}" must be attached once each to exactly one neuron, the model's own; they are attached to ${ownerNeurons.length} neurons`
            );
        }
    }
    const homeostatNeurons: TCNSHomeostatNeurons = {
        homeostatReceptorCorrection: new CNSHomeostatReceptorCorrection({ homeostatReceptors: [...homeostatReceptors] }).neuron,
        homeostatReceptors: [...homeostatReceptors].map(homeostatReceptor => homeostatReceptor.neuron),
    };
    const cns = createCNS<TCNSHomeostatNeuronDependencies<TModels, THandles>>([
        ...homeostatNeurons.homeostatReceptors.map(homeostatReceptorNeuron => () => homeostatReceptorNeuron),
        () => homeostatNeurons.homeostatReceptorCorrection,
        ...userNeurons.map(userNeuron => () => userNeuron),
    ], neuronDependencies);
    forwardingCNS.bind(cns);
    const neurons = neuronRecord as TNeurons;
    return { ...homeostatModels, cns, homeostatEnvironment, homeostatNeurons, neurons, dispose: () => homeostatEnvironment.dispose() };
}
