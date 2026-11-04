import type { OIMDB } from '@oimdb/core';
import { createOIMBrowserLocationSingleSlotService } from '@oimdb/browser';
import { CNSLocationHash } from './CNSLocationHash';
import type { ICNSExplorerAddress } from './interfaces/ICNSExplorerAddress';

export function createCNSHashExplorerAddress(db: OIMDB): ICNSExplorerAddress {
    const locationService = createOIMBrowserLocationSingleSlotService({ onBrowserEntityWritten: () => db.flush() });
    const locationSlot = locationService.createStoreAggregate(locationService.createStoreSlot(db));
    locationSlot.holdSingleSlot();
    return {
        read: () => CNSLocationHash.read(),
        readTracked: () => locationSlot.getSingleSlot().entity?.hash ?? '',
        write: hash => CNSLocationHash.write(hash),
    };
}
