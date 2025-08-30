import { CNS } from '../CNS';
import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNDendrite } from '../types/TCNDendrite';

export const collateral = <TPayload = undefined, TId extends string = string>(
    id: TId
) => new CNSCollateral<TId, TPayload>(id);

type InterNeuronAPI<
    TIdType extends string,
    TSenderCollateralIdType extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TReceiverAxon extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    id: TIdType;
    axon: TReceiverAxon;
    dendrites: TCNDendrite<
        string,
        unknown,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverAxon
    >[];
    dendrite: <
        TSenderExactCollateralIdType extends string,
        TSenderExactAxonCollateralPayload
    >(
        s: TCNDendrite<
            TSenderExactCollateralIdType,
            TSenderExactAxonCollateralPayload,
            TReceiverCollateralIdType,
            TReceiverAxonCollateralPayload,
            TReceiverAxon
        >
    ) => InterNeuronAPI<
        TIdType,
        TSenderExactCollateralIdType,
        TSenderExactAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverAxon
    >;
};

// Concrete builder
export const neuron = <
    TIdType extends string,
    TSenderCollateralIdType extends string,
    TSenderAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TReceiverAxon extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
>(
    id: TIdType,
    axon: TReceiverAxon
): InterNeuronAPI<
    TIdType,
    TSenderCollateralIdType,
    TSenderAxonCollateralPayload,
    TReceiverCollateralIdType,
    TReceiverAxonCollateralPayload,
    TReceiverAxon
> => {
    const dendrites: TCNDendrite<
        string,
        unknown,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverAxon
    >[] = [];

    const api: InterNeuronAPI<
        TIdType,
        TSenderCollateralIdType,
        TSenderAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverAxon
    > = {
        axon,
        id,
        dendrites,
        dendrite<
            TSenderExactCollateralIdType extends string,
            TSenderExactAxonCollateralPayload
        >(
            s: TCNDendrite<
                TSenderExactCollateralIdType,
                TSenderExactAxonCollateralPayload,
                TReceiverCollateralIdType,
                TReceiverAxonCollateralPayload,
                TReceiverAxon
            >
        ) {
            dendrites.push(
                s as TCNDendrite<
                    string,
                    unknown,
                    TReceiverCollateralIdType,
                    TReceiverAxonCollateralPayload,
                    TReceiverAxon
                >
            );
            return api; // keep full API for chaining
        },
    };

    return api;
};

const a1 = {
    test: collateral<{ test: string }>('test'),
};

const a2 = {
    test2: collateral<{ test2: string }>('test2'),
};

const a3 = {
    test3: collateral<{ test3: string }>('test3'),
};

const n1 = neuron('n1', a1).dendrite({
    collateral: a2.test2,
    reaction: async (payload: { test2: string }, axon) => {
        return axon.test.createSignal({
            test: payload.test2,
        });
    },
});

const n2 = neuron('n2', a2).dendrite({
    collateral: a3.test3,
    reaction: async (payload, axon) => {
        return axon.test2.createSignal({
            test2: payload.test3,
        });
    },
});

const cns = new CNS([n1, n2]);
