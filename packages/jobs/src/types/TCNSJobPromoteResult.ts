import type { TCNSJobTransition } from './TCNSJobTransition';

export type TCNSJobPromoteResult = {
    readyJobIds: string[];
    transitions: TCNSJobTransition[];
};
