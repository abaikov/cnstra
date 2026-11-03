import type { TCNSJobRunContext } from './TCNSJobRunContext';
import type { TCNSJobTypeDefinition } from './TCNSJobTypeDefinition';

export type TCNSJobHandler<TPayload = unknown> = {
    definition: TCNSJobTypeDefinition<TPayload>;
    run(payload: TPayload, context: TCNSJobRunContext<TPayload>): unknown;
};
