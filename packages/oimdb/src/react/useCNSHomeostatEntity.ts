import { useMemo } from 'react';
import { useOIMComputedValueByKey, useOIMEntityByKey } from '@oimdb/react';
import type { TCNSHomeostatModelEntityReader, TCNSHomeostatModelKey } from '@cnstra/sync';
import type { ICNSOIMDBHomeostatModelHandles } from '../interfaces/ICNSOIMDBHomeostatModelHandles';
import type { TCNSHomeostatEntityHomeostasis } from './types/TCNSHomeostatEntityHomeostasis';

export function useCNSHomeostatEntity<TEntity extends object, TId extends string | number, TKey extends TCNSHomeostatModelKey>(
    entityReader: TCNSHomeostatModelEntityReader<ICNSOIMDBHomeostatModelHandles, TEntity, TId, TKey>,
    id: TId
): TCNSHomeostatEntityHomeostasis<TEntity> {
    const entity = useOIMEntityByKey(entityReader.collection, id);
    const key = useMemo(() => entityReader.keyOf(id), [entityReader, id]);
    const homeostasis = useOIMComputedValueByKey(entityReader.homeostasis, key);
    return { entity, status: homeostasis.status, error: homeostasis.error };
}
