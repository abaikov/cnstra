import type { ECNSStimulationTaskStatus } from '@cnstra/persist-dto';

export type TCNSTaskRow = {
    key: string;
    stimulationId: string;
    attemptNumber: number;
    neuronName: string;
    input: string;
    output: string | null;
    status: ECNSStimulationTaskStatus;
    error: string | null;
    startedAt: number;
    duration: number | null;
};
