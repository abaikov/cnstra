import type { OIMDB } from '@oimdb/core';
import type { TCNSHomeostatBatchTransducerOptions } from '@cnstra/sync';
import type { TCNSDevToolsTransportKind } from '../../types/TCNSDevToolsTransportKind';
import type { ICNSExplorerActionClient } from '../interfaces/ICNSExplorerActionClient';
import type { TCNSExplorerAddressFactory } from './TCNSExplorerAddressFactory';

export type TCNSDevToolsOptions = {
    batchTransduceFn: TCNSHomeostatBatchTransducerOptions['batchTransduceFn'];
    actionClient: ICNSExplorerActionClient;
    transportKind: TCNSDevToolsTransportKind;
    isReadOnly?: boolean;
    getNowMs?: () => number;
    createExplorerAddress?: TCNSExplorerAddressFactory;
    db?: OIMDB;
};
