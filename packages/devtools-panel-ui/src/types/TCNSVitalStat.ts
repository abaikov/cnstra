import type { TCNSDevToolsNode } from './TCNSDevToolsNode';
import type { TCNSTone } from './TCNSTone';

export type TCNSVitalStat = {
    label: string;
    tone: TCNSTone;
    valueOf(c: TCNSDevToolsNode): number;
};
