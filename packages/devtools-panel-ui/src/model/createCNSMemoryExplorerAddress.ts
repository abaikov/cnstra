import type { OIMDB } from '@oimdb/core';
import { createHeldEntitySingle } from './createHeldEntitySingle';
import type { ICNSExplorerAddress } from './interfaces/ICNSExplorerAddress';

export function createCNSMemoryExplorerAddress(db: OIMDB): ICNSExplorerAddress {
    const address = createHeldEntitySingle(db, { hash: '' });
    const read = (): string => address.getSingleSlot().entity?.hash ?? '';
    return {
        read,
        readTracked: read,
        write: hash => address.writeSingleSlotContent({ hash }),
    };
}
