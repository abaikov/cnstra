export type TCNSJobRetryDecision = { kind: 'requeue'; runAfter: number } | { kind: 'final' };
