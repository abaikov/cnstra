import type { TCNSDiagramConfig } from './TCNSDiagramConfig';
import type { TCNSTone } from './TCNSTone';
import type { TCNSFact } from './TCNSFact';

export type TCNSScopeCard = {
    eyebrow: string;
    tone: TCNSTone;
    title: string;
    description: string;
    stat: number;
    statLabel: string;
    isEntry: boolean;
    facts: TCNSFact[];
    ratio?: { value: number; caption: string; tone: TCNSTone };
    diagram: TCNSDiagramConfig;
};
