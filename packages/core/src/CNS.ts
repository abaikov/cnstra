import { TCNSNeuron } from './types/TCNSNeuron';
import { TCNSDendrite } from './types/TCNSDendrite';
import { CNSCollateral } from './CNSCollateral';
import { ICNSStimulationContextStore } from './interfaces/ICNSStimulationContextStore';
import { CNSStimulationContextStore } from './CNSStimulationContextStore';

const asArray = <T>(x: T | T[]) => (Array.isArray(x) ? x : [x]);

type TSubscriber<
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> = {
    neuron: TNeuron;
    dendrite: TDendrite;
};

type TQueueItem<TCollateralId extends string> = {
    collateralId: TCollateralId;
    payload: unknown;
    hops: number;
    spikeId: string;
};

export class CNS<
    TCollateralId extends string,
    TNeuron extends TCNSNeuron<any, any, any, any, any, any, any>,
    TDendrite extends TCNSDendrite<any, any, any, any, any, any>
> {
    // index by collateral *type* => list of subscribers
    private subIndex = new Map<
        TCollateralId,
        TSubscriber<TNeuron, TDendrite>[]
    >();

    constructor(protected readonly neurons: TNeuron[]) {
        this.buildIndex();
    }

    private buildIndex() {
        this.subIndex.clear();
        for (const neuron of this.neurons) {
            for (const dendrite of neuron.dendrites) {
                const key = dendrite.collateral.id;
                const arr = this.subIndex.get(key) ?? [];
                arr.push({ neuron, dendrite: dendrite as TDendrite });
                this.subIndex.set(
                    key,
                    arr as TSubscriber<TNeuron, TDendrite>[]
                );
            }
        }
    }

    private async fanOut(
        incoming: TQueueItem<TCollateralId>,
        allowType: ((t: TCollateralId) => boolean) | undefined,
        seen: Set<string>,
        queue: TQueueItem<TCollateralId>[],
        ctx: ICNSStimulationContextStore
    ) {
        const subscribers = this.subIndex.get(incoming.collateralId);
        if (!subscribers || subscribers.length === 0) return;

        for (const { neuron, dendrite } of subscribers) {
            const k = `${neuron.id}::${incoming.collateralId}::${incoming.spikeId}`;
            if (seen.has(k)) continue;
            seen.add(k);

            const out = await dendrite.response(incoming.payload, neuron.axon, {
                get: () => ctx.get(neuron.id),
                set: value => ctx.set(neuron.id, value),
            });
            if (out === undefined) continue;

            for (const spike of asArray(out)) {
                if (allowType && !allowType(spike.type as TCollateralId))
                    continue; // TODO: add allowType

                queue.push({
                    collateralId: spike.type as TCollateralId,
                    payload: spike.payload,
                    hops: incoming.hops + 1,
                    spikeId: incoming.spikeId, // keep the same spike id across the cascade
                });
            }
        }
    }

    async stimulate<
        TAfferentCollateralId extends TCollateralId,
        TAfferentCollateralPayload
    >(
        collateral: CNSCollateral<
            TAfferentCollateralId,
            TAfferentCollateralPayload
        >,
        payload: TAfferentCollateralPayload,
        opts?: {
            maxHops?: number;
            allowType?: (t: TCollateralId) => boolean;
            onTrace?: (e: {
                collateralId: TCollateralId;
                hops: number;
                payload: unknown;
            }) => void;
            abortSignal?: AbortSignal;
            spikeId?: string;
            ctx?: ICNSStimulationContextStore;
        }
    ): Promise<void> {
        const ctx = opts?.ctx ?? new CNSStimulationContextStore();
        const spikeId = opts?.spikeId || Math.random().toString(36).slice(2);
        const maxHops = opts?.maxHops ?? 1000;

        const queue: TQueueItem<TCollateralId>[] = [
            {
                collateralId: collateral.id,
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
                collateralId: item.collateralId,
                hops: item.hops,
                payload: item.payload,
            });
            if (item.hops >= maxHops) continue;

            await this.fanOut(
                item as TQueueItem<TCollateralId>,
                opts?.allowType,
                seen,
                queue as TQueueItem<TCollateralId>[],
                ctx
            );
        }
    }
}
