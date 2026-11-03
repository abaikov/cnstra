import type { TCNSJobRunContext } from './TCNSJobRunContext';

export type TCNSJobRunMiddleware = (context: TCNSJobRunContext, next: () => Promise<unknown>) => Promise<unknown>;
