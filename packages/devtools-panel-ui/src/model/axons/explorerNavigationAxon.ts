import { collateral } from '@cnstra/core';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';

export const explorerNavigationAxon = {
    explorerQueryChanged: collateral<{ query: TCNSExplorerQuery }>(),
};
