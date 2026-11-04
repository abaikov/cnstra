import { collateral } from '@cnstra/core';
import type { TCNSStimulationCommand } from '@cnstra/persist-dto';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import type { TCNSExplorerTab } from '../../types/TCNSExplorerTab';
import type { TCNSNavigationEntryState } from '../types/TCNSNavigationEntryState';
import type { TCNSListName } from '../types/TCNSListName';

export const explorerUiAxon = {
    queryPatched: collateral<{ patch: Partial<TCNSExplorerQuery> }>(),
    tabSelected: collateral<{ tab: TCNSExplorerTab }>(),
    entityOpened: collateral<{ entry: TCNSNavigationEntryState; fresh: boolean }>(),
    navigatedBack: collateral(),
    crumbSelected: collateral<{ index: number }>(),
    stimulationRetryRequested: collateral<{ stimulationId: string }>(),
    stimulationCloneRequested: collateral<{ stimulationId: string }>(),
    stimulationCommandRequested: collateral<{ stimulationId: string; command: TCNSStimulationCommand }>(),
    stimulationLaunchRequested: collateral<{ collateralName: string; payload: unknown }>(),
    launchPayloadRejected: collateral<{ error: string }>(),
    cancelConfirmationRequested: collateral<{ stimulationId: string }>(),
    listNextPageRequested: collateral<{ listName: TCNSListName; queryKey: string; nextCursor: string | null }>(),
    listNewestRequested: collateral<{ listName: TCNSListName }>(),
};
