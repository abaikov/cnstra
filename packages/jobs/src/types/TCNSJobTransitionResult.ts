import type { TCNSJobState } from './TCNSJobState';
import type { TCNSJobTransition } from './TCNSJobTransition';

export type TCNSJobTransitionResult = {
    transitions: TCNSJobTransition[];
    claimed: TCNSJobState[];
};
