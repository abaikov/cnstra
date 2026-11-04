import type { TCNSConnectionStatistic } from './TCNSConnectionStatistic';

export type TCNSNeuronDetail = {
    name: string;
    throughput: number;
    errors: number;
    dendrites: TCNSConnectionStatistic[];
    axons: TCNSConnectionStatistic[];
};
