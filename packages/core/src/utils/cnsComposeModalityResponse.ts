export function cnsComposeModalityResponse(
    handler: (payload: any, axon: any, ctx: any) => any,
    output: (result: any, axon: any, ctx: any) => any
): (payload: any, axon: any, ctx: any) => any {
    return (payload, axon, ctx) => {
        const maybeResult = handler(payload, axon, ctx);
        if (maybeResult && typeof maybeResult.then === 'function') {
            return maybeResult.then((result: any) => output(result, axon, ctx));
        }
        try {
            return output(maybeResult, axon, ctx);
        } catch (error) {
            if (error instanceof Error && error.message.includes('Cannot read properties of undefined')) {
                const axonKeys = axon && typeof axon === 'object' ? Object.keys(axon) : 'not an object';
                throw new Error(
                    `modalityDendrite: axon.output is undefined. Axon type: ${typeof axon}, Axon keys: ${
                        Array.isArray(axonKeys) ? axonKeys.join(', ') : axonKeys
                    }. Make sure the neuron was created with the correct axon structure. Original error: ${
                        error.message
                    }`
                );
            }
            throw error;
        }
    };
}
