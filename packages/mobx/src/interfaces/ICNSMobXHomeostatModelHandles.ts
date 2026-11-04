import type { ICNSHomeostatModelHandles, TCNSHomeostatModelKey } from '@cnstra/sync';
import type { CNSMobXHomeostatBucketCollection } from '../CNSMobXHomeostatBucketCollection';
import type { CNSMobXHomeostatEntryCollection } from '../CNSMobXHomeostatEntryCollection';
import type { CNSMobXHomeostatEnvironment } from '../CNSMobXHomeostatEnvironment';
import type { CNSMobXHomeostatReceptiveField } from '../CNSMobXHomeostatReceptiveField';

export interface ICNSMobXHomeostatModelHandles extends ICNSHomeostatModelHandles {
    readonly homeostatEnvironment: CNSMobXHomeostatEnvironment;
    readonly receptiveDemand: Pick<CNSMobXHomeostatReceptiveField<TCNSHomeostatModelKey, unknown>, 'observeEntry'>;
    readonly entityCollection: CNSMobXHomeostatEntryCollection<string | number, this['entity']>;
    readonly bucketCollection: CNSMobXHomeostatBucketCollection<this['entity']>;
    readonly summaryCollection: CNSMobXHomeostatEntryCollection<TCNSHomeostatModelKey, this['summary']>;
    readonly homeostasis: Pick<CNSMobXHomeostatReceptiveField<this['key'], unknown>, 'createComputed'>;
}
