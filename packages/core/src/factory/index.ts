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

const request = collateral<{ value: number }>('request');
const success = collateral<{ result: string }>('success');
const error = collateral<{ error: string }>('error');

const router = neuron('router', { success, error }).dendrite({
    collateral: request,
    response: async (payload, axon) => {
        const value = (payload as { value: number }).value;
        if (value > 0) {
            return axon.success.createSignal({
                result: `Success: ${value}`,
            });
        } else {
            return axon.error.createSignal({
                error: `Error: ${value} is not positive`,
            });
        }
    },
});

const a1 = {
    test: collateral<{ test: string }>('test'),
};

const a2 = {
    test2: collateral<{ test2: string }>('test2'),
};

const a3 = {
    test3: collateral<{ test3: string }>('test3'),
};

const n1 = withCtx<{ testCtx: string }>()
    .neuron('n1', a1)
    .dendrite({
        collateral: a2.test2,
        response: async (payload, axon, ctx) => {
            ctx.set({
                testCtx: payload.test2,
            });
            ctx.get()?.testCtx;
            return axon.test.createSignal({
                test: payload.test2,
            });
        },
    });

const n2 = neuron('n2', a2).dendrite({
    collateral: a3.test3,
    response: async (payload, axon) => {
        return axon.test2.createSignal({
            test2: payload.test3,
        });
    },
});

const cns = new CNS([n1, n2]);
