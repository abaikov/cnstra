import type { TCNSTone } from './TCNSTone';

export type TCNSPayloadBlock = { label: string; payload: unknown; isPresent: boolean; tone: TCNSTone };
