import { CNS } from '../CNS';
import { CNSCollateral } from '../CNSCollateral';
import { TCNSAxon } from '../types/TCNSAxon';
import { TCNSDendrite } from '../types/TCNSDendrite';

export const collateral = <TPayload = undefined, TId extends string = string>(
    id: TId
) => new CNSCollateral<TId, TPayload>(id);

type InterNeuronAPI<
    TContextValue,
    TIdType extends string,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TAxonType extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
> = {
    id: TIdType;
    axon: TAxonType;
    dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >[];
    dendrite: <
        TSenderExactCollateralIdType extends string,
        TSenderExactAxonCollateralPayload
    >(
        s: TCNSDendrite<
            TContextValue,
            TSenderExactCollateralIdType,
            TSenderExactAxonCollateralPayload,
            TReceiverCollateralIdType,
            TReceiverAxonCollateralPayload,
            TAxonType
        >
    ) => InterNeuronAPI<
        TContextValue,
        TIdType,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >;
};

// Concrete builder
export const neuron = <
    TContextValue,
    TIdType extends string,
    TReceiverCollateralIdType extends string,
    TReceiverAxonCollateralPayload,
    TAxonType extends TCNSAxon<
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload
    >
>(
    id: TIdType,
    axon: TAxonType
): InterNeuronAPI<
    TContextValue,
    TIdType,
    TReceiverCollateralIdType,
    TReceiverAxonCollateralPayload,
    TAxonType
> => {
    const dendrites: TCNSDendrite<
        TContextValue,
        string,
        unknown,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TAxonType
    >[] = [];

    const api: InterNeuronAPI<
        TContextValue,
        TIdType,
        TReceiverCollateralIdType,
        TReceiverAxonCollateralPayload,
        TAxonType
    > = {
        axon,
        id,
        dendrites,
        dendrite<
            TSenderExactCollateralIdType extends string,
            TSenderExactAxonCollateralPayload
        >(
            s: TCNSDendrite<
                TContextValue,
                TSenderExactCollateralIdType,
                TSenderExactAxonCollateralPayload,
                TReceiverCollateralIdType,
                TReceiverAxonCollateralPayload,
                TAxonType
            >
        ) {
            dendrites.push(
                s as TCNSDendrite<
                    TContextValue,
                    string,
                    unknown,
                    TReceiverCollateralIdType,
                    TReceiverAxonCollateralPayload,
                    TAxonType
                >
            );
            return api; // keep full API for chaining
        },
    };

    return api;
};

export const withCtx = <TContextValue>() => ({
    neuron: <
        TIdType extends string,
        TReceiverCollateralIdType extends string,
        TReceiverAxonCollateralPayload,
        TAxonType extends TCNSAxon<
            TReceiverCollateralIdType,
            TReceiverAxonCollateralPayload
        >
    >(
        id: TIdType,
        axon: TAxonType
    ) => {
        return neuron<
            TContextValue,
            TIdType,
            TReceiverCollateralIdType,
            TReceiverAxonCollateralPayload,
            TAxonType
        >(id, axon);
    },
});
