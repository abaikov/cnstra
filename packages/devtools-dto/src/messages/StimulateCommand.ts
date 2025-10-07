export interface StimulateCommand {
    type: 'stimulate';
    stimulationCommandId: string;
    collateralName: string;
    payload?: unknown;
    contexts?: Record<string, unknown>;
    options?: Record<string, unknown>;
}

export interface StimulateAccepted {
    type: 'stimulate-accepted';
    stimulationCommandId: string;
    stimulationId: string;
}

export interface StimulateRejected {
    type: 'stimulate-rejected';
    stimulationCommandId: string;
    error: string;
}
