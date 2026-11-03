import type { TOIMEntitySlot } from '@oimdb/core';
import type { TCNSHomeostatCorrectionState } from '@cnstra/sync';
import type { TCNSOIMDBHomeostatKey } from './TCNSOIMDBHomeostatKey';

export type TCNSOIMDBHomeostatCorrectionSlot = TOIMEntitySlot<TCNSHomeostatCorrectionState<TCNSOIMDBHomeostatKey>, string>;
