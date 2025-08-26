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
    TReceiverAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
    TReceiverAxon extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    id: TIdType;
    axon: TReceiverAxon;
    dendrites: TCNDendrite<
        TSenderCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxon
    >[];
    dendrite: (
        s: TCNDendrite<
            TSenderCollateralIdType,
            TReceiverAxonCollateralPayload,
            TReceiverCollateralIdType,
            TReceiverAxon
        >
    ) => InterNeuronAPI<
        TIdType,
        TSenderCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxon
    >;
};

// Concrete builder
export const neuron = <
    TIdType extends string,
    TSenderCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TReceiverCollateralIdType extends string,
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
    TReceiverAxonCollateralPayload,
    TReceiverCollateralIdType,
    TReceiverAxon
> => {
    const dendrites: TCNDendrite<
        TSenderCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxon
    >[] = [];

    const api: InterNeuronAPI<
        TIdType,
        TSenderCollateralIdType,
        TReceiverAxonCollateralPayload,
        TReceiverCollateralIdType,
        TReceiverAxon
    > = {
        axon,
        id,
        dendrites,
        dendrite(
            s: TCNDendrite<
                TSenderCollateralIdType,
                TReceiverAxonCollateralPayload,
                TReceiverCollateralIdType,
                TReceiverAxon
            >
        ) {
            dendrites.push(s);
            return api; // keep full API for chaining
        },
    };

    return api;
};
