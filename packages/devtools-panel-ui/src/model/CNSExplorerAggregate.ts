import type { TCNSStimulationRosterFacets } from '@cnstra/persist-dto';
import { CNSTaskKey } from '../utils/CNSTaskKey';
import type { TCNSAttemptOwner } from '../types/TCNSAttemptOwner';
import type { TCNSCollateralDetail } from '../types/TCNSCollateralDetail';
import type { TCNSCollateralDispatch } from '../types/TCNSCollateralDispatch';
import type { TCNSCollateralRow } from '../types/TCNSCollateralRow';
import type { TCNSConnectionStatistic } from '../types/TCNSConnectionStatistic';
import type { TCNSExplorerSnapshot } from '../types/TCNSExplorerSnapshot';
import type { TCNSExplorerTopology } from '../types/TCNSExplorerTopology';
import type { TCNSNeuronDetail } from '../types/TCNSNeuronDetail';
import type { TCNSNeuronRow } from '../types/TCNSNeuronRow';
import type { TCNSSubscriberStatistic } from '../types/TCNSSubscriberStatistic';
import type { TCNSTaskRow } from '../types/TCNSTaskRow';
import { COLLATERAL_DISPATCH_LIMIT } from './constants/COLLATERAL_DISPATCH_LIMIT';
import { ENTRY_DISPATCH_STAGE } from './constants/ENTRY_DISPATCH_STAGE';

export class CNSExplorerAggregate {
    public static taskRows(snapshot: TCNSExplorerSnapshot): TCNSTaskRow[] {
        const attemptOwnerByAttemptId = CNSExplorerAggregate.attemptOwnerByAttemptIdOf(snapshot);
        const rows: TCNSTaskRow[] = snapshot.tasks.map(task => {
            const owner = attemptOwnerByAttemptId.get(task.stimulationAttemptId);
            return {
                key: CNSTaskKey.of(task),
                stimulationId: owner?.stimulationId ?? task.stimulationAttemptId,
                attemptNumber: owner?.attemptNumber ?? 1,
                neuronName: task.neuronName,
                input: task.dendriteCollateralName,
                output: task.output?.collateralName ?? null,
                status: task.status,
                error: task.error ?? null,
                startedAt: task.startedAt,
                duration: task.duration ?? null,
            };
        });
        rows.sort((left, right) => right.startedAt - left.startedAt);
        return rows;
    }

    public static neuronRows(topology: TCNSExplorerTopology, snapshot: TCNSExplorerSnapshot, facets: TCNSStimulationRosterFacets): TCNSNeuronRow[] {
        const throughputByNeuronName = CNSExplorerAggregate.throughputByNeuronNameOf(facets);
        const taskCountByNeuronName = new Map<string, number>();
        const errorCountByNeuronName = new Map<string, number>();
        for (const task of snapshot.tasks) {
            taskCountByNeuronName.set(task.neuronName, (taskCountByNeuronName.get(task.neuronName) ?? 0) + 1);
            if (task.error) errorCountByNeuronName.set(task.neuronName, (errorCountByNeuronName.get(task.neuronName) ?? 0) + 1);
        }
        const dendriteCountByNeuronName = new Map<string, number>();
        for (const dendrite of topology.dendrites) dendriteCountByNeuronName.set(dendrite.neuronName, (dendriteCountByNeuronName.get(dendrite.neuronName) ?? 0) + 1);
        const axonCountByNeuronName = new Map<string, number>();
        for (const collateral of topology.collaterals) {
            if (collateral.ownerNeuronName) axonCountByNeuronName.set(collateral.ownerNeuronName, (axonCountByNeuronName.get(collateral.ownerNeuronName) ?? 0) + 1);
        }
        return topology.neurons
            .map(neuron => ({
                name: neuron.name,
                throughput: throughputByNeuronName.get(neuron.name) ?? taskCountByNeuronName.get(neuron.name) ?? 0,
                errors: errorCountByNeuronName.get(neuron.name) ?? 0,
                dendrites: dendriteCountByNeuronName.get(neuron.name) ?? 0,
                axons: axonCountByNeuronName.get(neuron.name) ?? 0,
            }))
            .sort((left, right) => right.throughput - left.throughput || left.name.localeCompare(right.name));
    }

    public static neuronDetail(name: string, topology: TCNSExplorerTopology, snapshot: TCNSExplorerSnapshot, facets: TCNSStimulationRosterFacets): TCNSNeuronDetail {
        const throughputByNeuronName = CNSExplorerAggregate.throughputByNeuronNameOf(facets);
        let errors = 0;
        let taskCount = 0;
        const dendriteStatisticByCollateralName = new Map<string, TCNSConnectionStatistic>();
        const axonStatisticByCollateralName = new Map<string, TCNSConnectionStatistic>();
        for (const task of snapshot.tasks) {
            if (task.neuronName !== name) continue;
            taskCount++;
            if (task.error) errors++;
            const inputName = task.dendriteCollateralName;
            const inputStatistic = dendriteStatisticByCollateralName.get(inputName) ?? { collateralName: inputName, count: 0, error: 0 };
            inputStatistic.count++;
            if (task.error) inputStatistic.error++;
            dendriteStatisticByCollateralName.set(inputName, inputStatistic);
            const outputName = task.output?.collateralName;
            if (outputName) {
                const outputStatistic = axonStatisticByCollateralName.get(outputName) ?? { collateralName: outputName, count: 0, error: 0 };
                outputStatistic.count++;
                if (task.error) outputStatistic.error++;
                axonStatisticByCollateralName.set(outputName, outputStatistic);
            }
        }
        for (const dendrite of topology.dendrites) {
            if (dendrite.neuronName === name && !dendriteStatisticByCollateralName.has(dendrite.collateralName)) dendriteStatisticByCollateralName.set(dendrite.collateralName, { collateralName: dendrite.collateralName, count: 0, error: 0 });
        }
        for (const collateral of topology.collaterals) {
            if (collateral.ownerNeuronName === name && !axonStatisticByCollateralName.has(collateral.name)) axonStatisticByCollateralName.set(collateral.name, { collateralName: collateral.name, count: 0, error: 0 });
        }
        const byWeight = (left: TCNSConnectionStatistic, right: TCNSConnectionStatistic): number => right.count - left.count || left.collateralName.localeCompare(right.collateralName);
        return {
            name,
            throughput: throughputByNeuronName.get(name) ?? taskCount,
            errors,
            dendrites: [...dendriteStatisticByCollateralName.values()].sort(byWeight),
            axons: [...axonStatisticByCollateralName.values()].sort(byWeight),
        };
    }

    public static collateralRows(topology: TCNSExplorerTopology, snapshot: TCNSExplorerSnapshot): TCNSCollateralRow[] {
        const firesByCollateralName = new Map<string, number>();
        for (const task of snapshot.tasks) {
            const outputName = task.output?.collateralName;
            if (outputName) firesByCollateralName.set(outputName, (firesByCollateralName.get(outputName) ?? 0) + 1);
        }
        for (const stimulation of snapshot.stimulations) {
            const entryName = stimulation.entry?.collateralName;
            if (entryName) firesByCollateralName.set(entryName, (firesByCollateralName.get(entryName) ?? 0) + 1);
        }
        const subscriberNamesByCollateralName = new Map<string, string[]>();
        for (const dendrite of topology.dendrites) {
            const subscriberNames = subscriberNamesByCollateralName.get(dendrite.collateralName) ?? [];
            if (!subscriberNames.includes(dendrite.neuronName)) subscriberNames.push(dendrite.neuronName);
            subscriberNamesByCollateralName.set(dendrite.collateralName, subscriberNames);
        }
        return topology.collaterals
            .map(collateral => {
                const subscriberNames = subscriberNamesByCollateralName.get(collateral.name) ?? [];
                return {
                    name: collateral.name,
                    owner: collateral.ownerNeuronName,
                    isEntry: !collateral.ownerNeuronName,
                    subscribers: subscriberNames.length,
                    subscriberNames,
                    fires: firesByCollateralName.get(collateral.name) ?? 0,
                };
            })
            .sort((left, right) => right.fires - left.fires || left.name.localeCompare(right.name));
    }

    public static collateralDetail(name: string, topology: TCNSExplorerTopology, snapshot: TCNSExplorerSnapshot): TCNSCollateralDetail {
        const owner = topology.collaterals.find(collateral => collateral.name === name)?.ownerNeuronName;
        let fires = 0;
        for (const task of snapshot.tasks) if (task.output?.collateralName === name) fires++;
        for (const stimulation of snapshot.stimulations) if (stimulation.entry?.collateralName === name) fires++;
        const subscriberByNeuronName = new Map<string, TCNSSubscriberStatistic>();
        for (const dendrite of topology.dendrites) {
            if (dendrite.collateralName === name) subscriberByNeuronName.set(dendrite.neuronName, { neuronName: dendrite.neuronName, count: 0, error: 0 });
        }
        for (const task of snapshot.tasks) {
            if (task.dendriteCollateralName !== name) continue;
            const subscriber = subscriberByNeuronName.get(task.neuronName) ?? { neuronName: task.neuronName, count: 0, error: 0 };
            subscriber.count++;
            if (task.error) subscriber.error++;
            subscriberByNeuronName.set(task.neuronName, subscriber);
        }
        const attemptOwnerByAttemptId = CNSExplorerAggregate.attemptOwnerByAttemptIdOf(snapshot);
        const dispatches: TCNSCollateralDispatch[] = [];
        for (const task of snapshot.tasks) {
            if (task.output?.collateralName !== name) continue;
            dispatches.push({
                stimulationId: attemptOwnerByAttemptId.get(task.stimulationAttemptId)?.stimulationId ?? task.stimulationAttemptId,
                stage: task.index,
                neuronName: task.neuronName,
                isEntry: false,
                payload: task.output?.payload,
                error: task.error ?? null,
                startedAt: task.startedAt,
            });
        }
        for (const stimulation of snapshot.stimulations) {
            if (stimulation.entry?.collateralName !== name) continue;
            dispatches.push({
                stimulationId: stimulation.stimulationId,
                stage: ENTRY_DISPATCH_STAGE,
                neuronName: '',
                isEntry: true,
                payload: stimulation.entry?.payload,
                error: null,
                startedAt: stimulation.startedAt,
            });
        }
        dispatches.sort((left, right) => right.startedAt - left.startedAt);
        return {
            name,
            owner,
            isEntry: !owner,
            fires,
            subscribers: [...subscriberByNeuronName.values()].sort((left, right) => right.count - left.count || left.neuronName.localeCompare(right.neuronName)),
            dispatches: dispatches.slice(0, COLLATERAL_DISPATCH_LIMIT),
        };
    }

    private static attemptOwnerByAttemptIdOf(snapshot: TCNSExplorerSnapshot): Map<string, TCNSAttemptOwner> {
        const attemptOwnerByAttemptId = new Map<string, TCNSAttemptOwner>();
        for (const attempt of snapshot.attempts) attemptOwnerByAttemptId.set(attempt.stimulationAttemptId, { stimulationId: attempt.stimulationId, attemptNumber: attempt.attemptNumber });
        return attemptOwnerByAttemptId;
    }

    private static throughputByNeuronNameOf(facets: TCNSStimulationRosterFacets): Map<string, number> {
        const throughputByNeuronName = new Map<string, number>();
        for (const neuronCount of facets.byNeuron ?? []) throughputByNeuronName.set(neuronCount.name, neuronCount.count);
        return throughputByNeuronName;
    }
}
