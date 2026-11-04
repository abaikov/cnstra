import type { IOIMSlotSubscriptionListener, OIMEntitySlotCollectionStoreAggregate } from '@oimdb/core';
import type { ICNSHomeostatModelHandles } from '@cnstra/sync';
import type { CNSOIMDBHomeostatEnvironment } from '../CNSOIMDBHomeostatEnvironment';
import type { TCNSOIMDBHomeostasisComputedStoreAggregate } from '../types/TCNSOIMDBHomeostasisComputedStoreAggregate';
import type { TCNSOIMDBHomeostatBucketCollection } from '../types/TCNSOIMDBHomeostatBucketCollection';
import type { TCNSOIMDBHomeostatSummaryCollection } from '../types/TCNSOIMDBHomeostatSummaryCollection';

export interface ICNSOIMDBHomeostatModelHandles extends ICNSHomeostatModelHandles {
    readonly homeostatEnvironment: CNSOIMDBHomeostatEnvironment;
    readonly receptiveDemand: IOIMSlotSubscriptionListener;
    readonly entityCollection: OIMEntitySlotCollectionStoreAggregate<this['entity']>;
    readonly bucketCollection: TCNSOIMDBHomeostatBucketCollection<this['entity']>;
    readonly summaryCollection: TCNSOIMDBHomeostatSummaryCollection<this['summary']>;
    readonly homeostasis: TCNSOIMDBHomeostasisComputedStoreAggregate<this['key']>;
}
