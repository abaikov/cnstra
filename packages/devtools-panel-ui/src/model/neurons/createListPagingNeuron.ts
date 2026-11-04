import { neuron } from '@cnstra/core';
import { FIRST_PAGE } from '../../constants/FIRST_PAGE';
import { explorerUiAxon } from '../axons/explorerUiAxon';
import { listPagingAxon } from '../axons/listPagingAxon';
import { listPagingOf } from '../listPagingOf';
import { listPagingStateOf } from '../listPagingStateOf';
import type { TCNSListPagings } from '../types/TCNSListPagings';

export function createListPagingNeuron(options: { listPagings: TCNSListPagings }) {
    return neuron(listPagingAxon)
        .dendrite({
            collateral: explorerUiAxon.listNextPageRequested,
            response: ({ listName, queryKey, nextCursor }, axon) => {
                const listedPaging = listPagingOf(listPagingStateOf(options.listPagings, listName), queryKey);
                const paging = { pageCount: listedPaging.pageCount + 1, cursors: nextCursor === null ? listedPaging.cursors : [...listedPaging.cursors, nextCursor] };
                options.listPagings.writeSlotContentByKey(listName, { queryKey, paging });
                return axon.nextPageListed.createSignal({ listName, paging });
            },
        })
        .dendrite({
            collateral: explorerUiAxon.listNewestRequested,
            response: ({ listName }, axon) => {
                const listPagingState = listPagingStateOf(options.listPagings, listName);
                if (listPagingState === undefined) return undefined;
                options.listPagings.writeSlotContentByKey(listName, { queryKey: listPagingState.queryKey, paging: FIRST_PAGE });
                return axon.newestListed.createSignal({ listName });
            },
        });
}
