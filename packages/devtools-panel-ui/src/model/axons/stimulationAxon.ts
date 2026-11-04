import { collateral } from '@cnstra/core';

export const stimulationAxon = {
    stimulationsChanged: collateral<{ stimulationIds: string[] }>(),
};
