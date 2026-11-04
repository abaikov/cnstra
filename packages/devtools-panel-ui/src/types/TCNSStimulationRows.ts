import type { TCNSStimulationRosterRow } from '@cnstra/persist-dto';
import type { TCNSPagedRows } from './TCNSPagedRows';

export type TCNSStimulationRows = TCNSPagedRows<TCNSStimulationRosterRow> & { nextCursor: string | null; isHeadCut: boolean };
