import { Stimulation } from '../entities/Stimulation';

/**
 * Real-time stimulation message sent over DevTools protocol.
 *
 * Extends Stimulation entity with runtime-only monitoring fields.
 * These fields are NOT stored in the database, only used for live metrics.
 *
 * @see Stimulation - the base entity with all persistent data
 */
export interface StimulationMessage extends Stimulation {
    /** Message type discriminator for transport layer */
    type: 'stimulation';
    /** Number of stimulations in the processing queue (runtime metric) */
    queueLength: number;
    /** Number of hops this stimulation has taken (runtime metric) */
    hops?: number;
    /** Error information if stimulation failed (runtime metric) */
    error?: unknown;
}
