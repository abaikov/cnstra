import type {
    TCNSStimulationAttempt,
    TCNSStimulationState,
    TCNSStimulationTask,
} from '@cnstra/persist-dto';
import type { ICNSStimulationWriter } from './interfaces/ICNSStimulationRepository';

/**
 * Writes one run to several sinks from a single {@link CNSStimulationPersistor},
 * so the task numbering and the `inputIndex` space stay shared — one persistor
 * per sink would number the same run independently several times over.
 *
 * A sink that throws is logged and skipped rather than failing the write for the
 * others. Reads ask each in turn and take the first answer, so put the real store
 * first.
 */
export class CNSFanOutStimulationWriter implements ICNSStimulationWriter {
    constructor(private readonly writers: readonly ICNSStimulationWriter[]) {}

    async saveStimulation(stimulation: TCNSStimulationState): Promise<void> {
        await this.each('saveStimulation', writer =>
            writer.saveStimulation(stimulation)
        );
    }

    async saveAttempt(attempt: TCNSStimulationAttempt): Promise<void> {
        await this.each('saveAttempt', writer => writer.saveAttempt(attempt));
    }

    async appendTask(task: TCNSStimulationTask): Promise<void> {
        await this.each('appendTask', writer => writer.appendTask(task));
    }

    async getStimulation(
        stimulationId: string
    ): Promise<TCNSStimulationState | undefined> {
        for (const writer of this.writers) {
            try {
                const found = await writer.getStimulation(stimulationId);
                if (found) return found;
            } catch (error) {
                console.error(
                    '[CNStra] fan-out sink threw on getStimulation',
                    error
                );
            }
        }

        return undefined;
    }

    /** Runs `write` on every sink, isolating each one's failure from the rest. */
    private async each(
        operation: string,
        write: (writer: ICNSStimulationWriter) => Promise<void>
    ): Promise<void> {
        const settled = await Promise.allSettled(
            // The call itself is inside the promise so a synchronous throw is
            // caught here too, not thrown at the caller before any sink ran.
            this.writers.map(async writer => write(writer))
        );

        for (const result of settled) {
            if (result.status === 'rejected') {
                console.error(
                    `[CNStra] fan-out sink threw on ${operation}`,
                    result.reason
                );
            }
        }
    }
}
