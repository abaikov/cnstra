import type { ICNSHomeostatModelHandles } from '../interfaces/ICNSHomeostatModelHandles';

export type TCNSHomeostatModelHandle<
    THandles extends ICNSHomeostatModelHandles,
    THandleName extends 'entityCollection' | 'bucketCollection' | 'summaryCollection' | 'homeostasis',
    TArguments extends Partial<Pick<ICNSHomeostatModelHandles, 'entity' | 'key' | 'summary'>>,
> = (THandles & TArguments)[THandleName];
