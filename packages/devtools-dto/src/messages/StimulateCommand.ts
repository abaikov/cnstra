export interface StimulateCommand {
    type: 'stimulate';
    stimulationCommandId: string;
    collateralName: string;
    payload?: unknown;
    contexts?: Record<string, unknown>;
    options?: Record<string, unknown>;
    appId?: string;
    cnsId?: string;
}

export interface StimulateAccepted {
    type: 'stimulate-accepted';
    stimulationCommandId: string;
    stimulationId: string;
    appId?: string;
}

export interface StimulateRejected {
    type: 'stimulate-rejected';
    stimulationCommandId: string;
    error: string;
    appId?: string;
}
