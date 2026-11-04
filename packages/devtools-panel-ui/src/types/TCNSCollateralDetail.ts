import type { TCNSCollateralDispatch } from './TCNSCollateralDispatch';
import type { TCNSSubscriberStatistic } from './TCNSSubscriberStatistic';

export type TCNSCollateralDetail = {
    name: string;
    owner?: string;
    isEntry: boolean;
    fires: number;
    subscribers: TCNSSubscriberStatistic[];
    dispatches: TCNSCollateralDispatch[];
};
