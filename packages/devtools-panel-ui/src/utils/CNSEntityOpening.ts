import type { TCNSNavigationEntryKind } from '../model/types/TCNSNavigationEntryKind';
import type { TCNSNavigationEntryState } from '../model/types/TCNSNavigationEntryState';

export class CNSEntityOpening {
    public static of(kind: TCNSNavigationEntryKind, id: string, fresh: boolean): { entry: TCNSNavigationEntryState; fresh: boolean } {
        return { entry: { kind, id }, fresh };
    }
}
