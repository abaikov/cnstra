export type TCNSCollateralRow = {
    name: string;
    owner?: string;
    isEntry: boolean;
    subscribers: number;
    subscriberNames: string[];
    fires: number;
};
