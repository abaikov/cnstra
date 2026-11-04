import type { createHeldEntitySingle } from '../createHeldEntitySingle';

export type TCNSHeldEntitySingle<TEntity extends object> = ReturnType<typeof createHeldEntitySingle<TEntity>>;
