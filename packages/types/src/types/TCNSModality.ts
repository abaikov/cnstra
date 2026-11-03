import { TCNSAfferentPath } from './TCNSAfferentPath';

export type TCNSModality = {
    readonly index: number;
    afferentPaths: Record<string | number, TCNSAfferentPath>;
};
