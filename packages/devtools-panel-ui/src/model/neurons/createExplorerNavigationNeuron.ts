import { neuron } from '@cnstra/core';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import { CNSExplorerNavigation } from '../CNSExplorerNavigation';
import { CNSExplorerQuery } from '../CNSExplorerQuery';
import { connectionAxon } from '../axons/connectionAxon';
import { explorerNavigationAxon } from '../axons/explorerNavigationAxon';
import { explorerUiAxon } from '../axons/explorerUiAxon';
import type { ICNSExplorerAddress } from '../interfaces/ICNSExplorerAddress';

export function createExplorerNavigationNeuron(options: { getNowMs: () => number; explorerAddress: ICNSExplorerAddress }) {
    const readQuery = (): TCNSExplorerQuery => CNSExplorerNavigation.queryOfHash(options.explorerAddress.read());
    const writeQuery = (query: TCNSExplorerQuery) => {
        const search = CNSExplorerQuery.encode(query);
        options.explorerAddress.write(`#/${search ? `?${search}` : ''}`);
        return explorerNavigationAxon.explorerQueryChanged.createSignal({ query });
    };
    return neuron(explorerNavigationAxon)
        .dendrite({ collateral: explorerUiAxon.queryPatched, response: ({ patch }) => writeQuery({ ...readQuery(), ...patch }) })
        .dendrite({ collateral: explorerUiAxon.tabSelected, response: ({ tab }) => writeQuery(CNSExplorerNavigation.withTabSelected(readQuery(), tab)) })
        .dendrite({ collateral: explorerUiAxon.entityOpened, response: ({ entry, fresh }) => writeQuery(CNSExplorerNavigation.withEntityOpened(readQuery(), entry, fresh)) })
        .dendrite({ collateral: explorerUiAxon.navigatedBack, response: () => writeQuery(CNSExplorerNavigation.withBack(readQuery())) })
        .dendrite({ collateral: explorerUiAxon.crumbSelected, response: ({ index }) => writeQuery(CNSExplorerNavigation.withCrumb(readQuery(), index)) })
        .dendrite({
            collateral: connectionAxon.uiConfigApplied,
            response: ({ uiConfig }) => {
                const query = readQuery();
                if (!uiConfig.defaultWindowMs || query.since !== undefined || query.until !== undefined) return undefined;
                return writeQuery({ ...query, since: options.getNowMs() - uiConfig.defaultWindowMs });
            },
        });
}
