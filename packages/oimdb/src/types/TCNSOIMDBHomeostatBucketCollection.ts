import type { createCNSOIMDBHomeostatBucketCollection } from '../utils/createCNSOIMDBHomeostatBucketCollection';

export type TCNSOIMDBHomeostatBucketCollection<TEntity extends object> = ReturnType<typeof createCNSOIMDBHomeostatBucketCollection<TEntity>>;
