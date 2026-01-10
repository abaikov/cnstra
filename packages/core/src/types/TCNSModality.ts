import { TCNSAfferentPath } from './TCNSAfferentPath';

export type TCNSModality = {
    afferentPaths: Record<string | number, TCNSAfferentPath>;
};
