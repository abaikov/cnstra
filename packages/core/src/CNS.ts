import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSAxon } from './types/TCNSAxon';
import { TCNDendrite } from './types/TCNDendrite';

const asArray = <T>(x: T | T[]) => (Array.isArray(x) ? x : [x]);

type Subscriber<
    TCollateralId extends string,
    TAxon extends TCNSAxon<TCollateralId, any>
> = {
    neuron: TCNSNeuron<
        string,
        TCollateralId,
        TAxon,
        TCollateralId,
        TCNDendrite<TCollateralId, any, TCollateralId, TAxon>[]
    >;
    dendrite: TCNDendrite<TCollateralId, any, TCollateralId, TAxon>;
};

type QueueItem<TEdgeId extends string> = {
    edgeId: TEdgeId;
    payload: unknown;
    hops: number;
    spikeId: string;
};

export class CNS<
    TAfferentCollateralId extends string,
    TAfferentAxon extends TCNSAxon<TAfferentCollateralId, unknown>,
    TNeuronId extends string,
    TCollateralId extends string,
    TAxon extends TCNSAxon<TCollateralId, any>
> {
    // index by collateral *type* => list of subscribers
    private subIndex = new Map<
        TCollateralId,
        Subscriber<TCollateralId, TAxon>[]
    >();

    constructor(
        protected readonly afferentLayerAsAxon: TAfferentAxon,
        protected readonly neurons: TCNSNeuron<
            TNeuronId,
            TCollateralId,
            TAxon,
            TCollateralId,
            TCNDendrite<TCollateralId, any, TCollateralId, TAxon>[]
        >[]
    ) {
        this.buildIndex();
    }

    private buildIndex() {
        this.subIndex.clear();
        for (const neuron of this.neurons) {
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral.id;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite });
                this.subIndex.set(
                    key,
                    arr as Subscriber<TCollateralId, TAxon>[]
                );
            }
        }
    }

    private async fanOut(
        incoming: QueueItem<TCollateralId>,
        allowType: ((t: TCollateralId) => boolean) | undefined,
        seen: Set<string>,
        queue: QueueItem<TCollateralId>[]
    ) {
        const subscribers = this.subIndex.get(incoming.edgeId);
        if (!subscribers || subscribers.length === 0) return;

        for (const { neuron, dendrite } of subscribers) {
            const k = `${neuron.id}::${incoming.edgeId}::${incoming.spikeId}`;
            if (seen.has(k)) continue;
            seen.add(k);

            const out = await dendrite.reaction(incoming.payload, neuron.axon);
            if (out === undefined) continue;

            for (const spike of asArray(out)) {
                if (allowType && !allowType(spike.type as TCollateralId))
                    continue; // TODO: add allowType

                queue.push({
                    edgeId: spike.type as TCollateralId,
                    payload: spike.payload,
                    hops: incoming.hops + 1,
                    spikeId: incoming.spikeId, // keep the same spike id across the cascade
                });
            }
        }
    }

    async stimulate<
        K extends keyof TAfferentAxon,
        TACollateralId extends string
    >(
        axonKey: K,
        payload: ReturnType<TAfferentAxon[K]['createSignal']> & {
            type: TACollateralId;
        },
        opts?: {
            maxHops?: number;
            allowType?: (t: TCollateralId | TAfferentCollateralId) => boolean;
            onTrace?: (e: {
                edgeId: TCollateralId | TAfferentCollateralId;
                hops: number;
                payload: unknown;
            }) => void;
            abortSignal?: AbortSignal;
            spikeId?: string;
        }
    ): Promise<void> {
        const afferent = this.afferentLayerAsAxon[axonKey];
        const spikeId = opts?.spikeId || Math.random().toString(36).slice(2);
        const maxHops = opts?.maxHops ?? 1000;

        const queue: QueueItem<TCollateralId | TAfferentCollateralId>[] = [
            {
                edgeId: afferent.id,
                payload,
                hops: 0,
                spikeId,
            },
        ];
        const seen = new Set<string>();

        while (queue.length) {
            if (opts?.abortSignal?.aborted) break;

            const item = queue.shift()!;
            opts?.onTrace?.({
                edgeId: item.edgeId,
                hops: item.hops,
                payload: item.payload,
            });
            if (item.hops >= maxHops) continue;

            await this.fanOut(
                item as QueueItem<TCollateralId>,
                opts?.allowType,
                seen,
                queue as QueueItem<TCollateralId>[]
            );
        }
    }
}
