export class CNSInstanceNeuronQueue<
    TNeuron extends { name: string; concurrency?: number }
> {
    private readonly gates = new Map<
        string,
        { limit: number; active: number; waiters: (() => void)[] }
    >();

    run(
        neuron: TNeuron,
        fn: () => (() => void) | Promise<() => void>
    ): (() => void) | Promise<() => void> {
        const limit = neuron?.concurrency;
        if (limit === undefined || limit <= 0) {
            return fn();
        }

        let gate = this.gates.get(neuron.name);
        if (!gate) {
            gate = { limit, active: 0, waiters: [] };
            this.gates.set(neuron.name, gate);
        } else {
            gate.limit = limit;
        }

        const wrap = (cb: () => void) => {
            return () => {
                try {
                    cb();
                } finally {
                    const g = this.gates.get(neuron.name)!;
                    g.active = Math.max(0, g.active - 1);
                    if (g.waiters.length > 0) {
                        const next = g.waiters.shift()!;
                        next();
                    }
                }
            };
        };

        if (gate.active < gate.limit) {
            gate.active++;
            const ret = fn();
            if (ret && typeof (ret as any).then === 'function') {
                return (ret as Promise<() => void>).then(cb => wrap(cb));
            }
            return wrap(ret as () => void);
        }

        return new Promise<() => void>(resolve => {
            const starter = () => {
                const g = this.gates.get(neuron.name)!;
                g.active++;
                const ret = fn();
                if (ret && typeof (ret as any).then === 'function') {
                    (ret as Promise<() => void>).then(cb => resolve(wrap(cb)));
                } else {
                    resolve(wrap(ret as () => void));
                }
            };
            gate!.waiters.push(starter);
        });
    }
}
