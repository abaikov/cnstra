import type { TCNSListPagination } from './TCNSListPagination';

export type TCNSListItems<TItem> = { items: readonly TItem[]; emptyText: string; pagination?: TCNSListPagination };
