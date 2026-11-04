import type { TCNSNavigationEntryState } from '../model/types/TCNSNavigationEntryState';
import type { TCNSTone } from './TCNSTone';

export type TCNSFact = { label: string; value: string; tone: TCNSTone; opens?: TCNSNavigationEntryState };
