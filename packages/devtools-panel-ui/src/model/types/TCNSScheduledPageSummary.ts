import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';

export type TCNSScheduledPageSummary = Omit<TCNSDevToolsSyncData['scheduledPage'], 'rows'>;
