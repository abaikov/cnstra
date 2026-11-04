import type { TExoDomNode } from '@exodra/dom';
import type { ECNSScheduledStimulationStatus, ECNSStimulationStatus, ECNSStimulationTaskStatus } from '@cnstra/persist-dto';
import type { TCNSStatusPillPorts } from '../types/TCNSStatusPillPorts';

export class CNSStatusPill {
    public static show(c: TExoDomNode, ports: TCNSStatusPillPorts, status: ECNSStimulationStatus | ECNSStimulationTaskStatus | ECNSScheduledStimulationStatus): void {
        c.attr(ports.pillStatus, status);
        c.text(ports.pillText, status);
    }
}
