/**
 * Server → panel: a retry was rejected — the clean "unsupported for this delivery"
 * answer (e.g. pg-boss + retry), the seam future capability flags disable through.
 */
export type TCNSStimulationRetryRejectedMessage = {
    type: 'stimulation.retry.rejected';
    requestId: string;
    stimulationId: string;
    reason: string;
};
