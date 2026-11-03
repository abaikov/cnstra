import type { TCNSJobTransition } from './TCNSJobTransition';

export type TCNSJobCancelResult = {
    cancelled: string[];
    requested: string[];
    transitions?: TCNSJobTransition[];
};
