import type { OIMDB } from '@oimdb/core';
import type { ICNSExplorerAddress } from '../interfaces/ICNSExplorerAddress';

export type TCNSExplorerAddressFactory = (db: OIMDB) => ICNSExplorerAddress;
