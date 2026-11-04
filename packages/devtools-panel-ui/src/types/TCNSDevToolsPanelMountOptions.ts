import type { OIMDB } from '@oimdb/core';
import type { TCNSDevToolsPanelLocation } from './TCNSDevToolsPanelLocation';
import type { TCNSDevToolsPanelTransportKind } from './TCNSDevToolsPanelTransportKind';

export type TCNSDevToolsPanelMountOptions = {
    readonly url: string;
    readonly transport?: TCNSDevToolsPanelTransportKind;
    readonly isReadOnly?: boolean;
    readonly location?: TCNSDevToolsPanelLocation;
    readonly db?: OIMDB;
};
