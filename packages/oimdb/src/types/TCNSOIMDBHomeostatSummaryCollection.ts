import type { createCNSOIMDBHomeostatSummaryCollection } from '../utils/createCNSOIMDBHomeostatSummaryCollection';

export type TCNSOIMDBHomeostatSummaryCollection<TSummary extends object> = ReturnType<typeof createCNSOIMDBHomeostatSummaryCollection<TSummary>>;
