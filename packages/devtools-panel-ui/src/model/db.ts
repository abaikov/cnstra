import { entities, index } from '@oimdb/core/oimdb';
import type { TCNSAppDTO } from '@cnstra/devtools-dto';

const apps = entities<TCNSAppDTO>();

export const db = {
    apps,
    allApps: index(apps, { keyOf: () => 'all' }),
};
