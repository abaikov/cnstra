import type { ICNS, TCNSNeuron, CNSCollateral, CNSPersistOptionsRegistry } from '@cnstra/core';

type AnyNeuron = TCNSNeuron<any, any>;
type AnyCollateral = CNSCollateral<unknown>;


// ─── Graph dump ──────────────────────────────────────────────────────────────

/**
 * Produces a Markdown description of the static CNS graph.
 * Commit the result as CNS_GRAPH.md so AI tools can read the architecture.
 *
 * @example
 * // cns.debug.ts  (excluded from prod entry point)
 * import { writeFileSync } from 'fs';
 * import { dumpCNSGraph } from '@cnstra/devtools';
 * import { cns } from './cns';
 * import { registry } from './neurons/registry';
 *
 * writeFileSync('CNS_GRAPH.md', dumpCNSGraph(cns, registry));
 */
export function dumpCNSGraph(
    cns: ICNS<AnyNeuron>,
    registry: CNSPersistOptionsRegistry
): string {
    const named = registry.getNamedNeurons();
    const lines: string[] = ['# CNS Graph', ''];

    for (const [name, neuron] of named) {
        lines.push(`## ${name}`, '');

        const axonEntries = Object.entries(neuron.axon);
        if (axonEntries.length > 0) {
            lines.push('**Emits:**');
            for (const [key, col] of axonEntries) {
                const colName = registry.getCollateralName(col as AnyCollateral) ?? key;
                const subscribers = cns.network
                    .getSubscribers(col as AnyCollateral)
                    .map(s => registry.getNeuronName(s.neuron as AnyNeuron) ?? '?')
                    .join(', ');
                lines.push(
                    subscribers
                        ? `  - \`${colName}\` → ${subscribers}`
                        : `  - \`${colName}\``
                );
            }
            lines.push('');
        }

        if (neuron.dendrites.length > 0) {
            lines.push('**Reacts to:**');
            for (const dendrite of neuron.dendrites) {
                const col = dendrite.collateral as AnyCollateral;
                const colName = registry.getCollateralName(col) ?? '(unknown)';
                const owner = cns.network.getParentNeuronByCollateral(col);
                const ownerName = owner
                    ? (registry.getNeuronName(owner as AnyNeuron) ?? '?')
                    : '(external)';
                lines.push(`  - \`${colName}\` from **${ownerName}**`);
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}

// ─── History logger ───────────────────────────────────────────────────────────

type StimulationRecord = {
    id: number;
    timestamp: number;
    initial: string;
    hops: Array<{ from: string; to: string | null; error?: string }>;
};

export type CNSHistoryLoggerOptions = {
    /** How many stimulations to keep in the ring buffer. Default: 100 */
    maxRecords?: number;
};

/**
 * Subscribes to a CNS instance and records the stimulation history.
 * Call dump() to get a Markdown snapshot — useful for AI sessions.
 *
 * @example
 * import { CNSHistoryLogger } from '@cnstra/devtools';
 * import { cns } from './cns';
 * import { registry } from './neurons/registry';
 *
 * const logger = new CNSHistoryLogger(cns, registry);
 * // ... run the app ...
 * console.log(logger.dump());
 * logger.stop();
 */
export class CNSHistoryLogger {
    private readonly records: StimulationRecord[] = [];
    private readonly stimMap = new WeakMap<object, StimulationRecord>();
    private counter = 0;
    private readonly maxRecords: number;
    private readonly registry: CNSPersistOptionsRegistry;
    private readonly stop_: () => void;

    constructor(
        cns: ICNS<AnyNeuron>,
        registry: CNSPersistOptionsRegistry,
        options: CNSHistoryLoggerOptions = {}
    ) {
        this.maxRecords = options.maxRecords ?? 100;
        this.registry = registry;
        this.stop_ = cns.addResponseListener((r) => this.onResponse(r));
    }

    private resolve(col: AnyCollateral | undefined): string {
        if (!col) return '(none)';
        return this.registry.getCollateralName(col) ?? '(unknown)';
    }

    private onResponse(r: Parameters<Parameters<ICNS<AnyNeuron>['addResponseListener']>[0]>[0]): void {
        const key = r.stimulation as object;
        let record = this.stimMap.get(key);

        if (!record) {
            record = {
                id: ++this.counter,
                timestamp: Date.now(),
                initial: this.resolve(r.outputSignal?.collateral as AnyCollateral),
                hops: [],
            };
            this.stimMap.set(key, record);
            this.records.push(record);
            if (this.records.length > this.maxRecords) this.records.shift();
        }

        if (r.inputSignal) {
            record.hops.push({
                from: this.resolve(r.inputSignal.collateral as AnyCollateral),
                to: r.outputSignal
                    ? this.resolve(r.outputSignal.collateral as AnyCollateral)
                    : null,
                error: r.error?.message,
            });
        }
    }

    dump(): string {
        if (this.records.length === 0)
            return '# CNS History\n\n(no stimulations recorded yet)\n';

        const lines = ['# CNS History', ''];
        for (const rec of [...this.records].reverse()) {
            const time = new Date(rec.timestamp).toISOString().slice(11, 23);
            lines.push(`### #${rec.id} · ${time}`);
            lines.push(`triggered by: \`${rec.initial}\``);
            for (const hop of rec.hops) {
                if (hop.error) {
                    lines.push(`  - \`${hop.from}\` ❌ ${hop.error}`);
                } else if (hop.to) {
                    lines.push(`  - \`${hop.from}\` → \`${hop.to}\``);
                } else {
                    lines.push(`  - \`${hop.from}\` (no output)`);
                }
            }
            lines.push('');
        }
        return lines.join('\n');
    }

    stop(): void {
        this.stop_();
    }
}
