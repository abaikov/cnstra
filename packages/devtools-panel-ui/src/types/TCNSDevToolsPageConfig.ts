import type { OIMDB } from '@oimdb/core';
import type { TCNSDevToolsPanelLocation } from './TCNSDevToolsPanelLocation';
import type { TCNSDevToolsTransportKind } from './TCNSDevToolsTransportKind';

export type TCNSDevToolsPageConfig = {
    readonly httpUrl: string;
    readonly socketUrl: string;
    readonly transportKind: TCNSDevToolsTransportKind;
    readonly isReadOnly: boolean;
    readonly location: TCNSDevToolsPanelLocation;
    readonly db?: OIMDB;
};
