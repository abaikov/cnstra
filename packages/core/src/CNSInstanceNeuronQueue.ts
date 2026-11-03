export class CNSInstanceNeuronQueue<
    TNeuron extends { readonly index: number; concurrency?: number }
> {
    private readonly gatesByNeuronIndex: { limit: number; active: number; waiters: (() => void)[] }[] = [];

    run(
        neuron: TNeuron,
        fn: () => (() => void) | Promise<() => void>
    ): (() => void) | Promise<() => void> {
        const limit = neuron?.concurrency;
        if (limit === undefined || limit <= 0) {
            return fn();
        }

        let gate = this.gatesByNeuronIndex[neuron.index];
        if (!gate) {
            gate = { limit, active: 0, waiters: [] };
            this.gatesByNeuronIndex[neuron.index] = gate;
        } else {
            gate.limit = limit;
        }
        const ownGate = gate;

        const wrap = (cb: () => void) => {
            return () => {
                try {
                    cb();
                } finally {
                    ownGate.active = Math.max(0, ownGate.active - 1);
                    if (ownGate.waiters.length > 0) {
                        const next = ownGate.waiters.shift()!;
                        next();
                    }
                }
            };
        };

        if (ownGate.active < ownGate.limit) {
            ownGate.active++;
            const ret = fn();
            if (ret && typeof (ret as any).then === 'function') {
                return (ret as Promise<() => void>).then(cb => wrap(cb));
            }
            return wrap(ret as () => void);
        }

        return new Promise<() => void>(resolve => {
            const starter = () => {
                ownGate.active++;
                const ret = fn();
                if (ret && typeof (ret as any).then === 'function') {
                    (ret as Promise<() => void>).then(cb => resolve(wrap(cb)));
                } else {
                    resolve(wrap(ret as () => void));
                }
            };
            ownGate.waiters.push(starter);
        });
    }
}
