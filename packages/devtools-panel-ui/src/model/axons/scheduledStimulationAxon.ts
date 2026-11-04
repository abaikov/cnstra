import { collateral } from '@cnstra/core';

export const scheduledStimulationAxon = {
    scheduledStimulationsChanged: collateral<{ stimulationIds: string[] }>(),
};
