import { hashCNSHomeostatKey, isCNSHomeostatSameValue } from '@cnstra/sync';
import type { TCNSHomeostatModelKey } from '@cnstra/sync';
import { CNSMobXHomeostatEntryCollection } from './CNSMobXHomeostatEntryCollection';
import type { ICNSMobXHomeostatModelHandles } from './interfaces/ICNSMobXHomeostatModelHandles';

export class CNSMobXHomeostatBucketCollection<TEntity extends object> {
    private readonly entityCollection: CNSMobXHomeostatEntryCollection<string | number, TEntity>;

    private readonly idsCollection: CNSMobXHomeostatEntryCollection<TCNSHomeostatModelKey, readonly (string | number)[]>;

    public constructor(
        entityCollection: CNSMobXHomeostatEntryCollection<string | number, TEntity>,
        receptiveDemand: ICNSMobXHomeostatModelHandles['receptiveDemand'],
        keepAfterIdleMs: number
    ) {
        this.entityCollection = entityCollection;
        this.idsCollection = new CNSMobXHomeostatEntryCollection<TCNSHomeostatModelKey, readonly (string | number)[]>({
            entryKeyHashFn: hashCNSHomeostatKey,
            isSameValue: isCNSHomeostatSameValue,
            receptiveDemand,
            keepAfterIdleMs,
            entryMemberHold: {
                holdMembers: ids => { for (const id of ids) entityCollection.holdEntry(id); },
                unholdMembers: ids => { for (const id of ids) entityCollection.unholdEntry(id); },
            },
        });
    }

    public getEntities(key: TCNSHomeostatModelKey): readonly (TEntity | undefined)[] {
        return (this.idsCollection.getEntry(key) ?? []).map(id => this.entityCollection.getEntry(id));
    }

    public peekEntities(key: TCNSHomeostatModelKey): readonly (TEntity | undefined)[] | undefined {
        return this.idsCollection.peekEntry(key)?.map(id => this.entityCollection.peekEntry(id));
    }

    public writeBucket(key: TCNSHomeostatModelKey, ids: readonly (string | number)[]): boolean {
        const wasEmpty = (this.idsCollection.peekEntry(key) ?? []).length === 0;
        const isWritten = this.idsCollection.writeEntry(key, ids);
        return isWritten && !(wasEmpty && ids.length === 0);
    }
}
