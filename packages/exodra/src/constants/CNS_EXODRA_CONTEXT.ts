import { exoContextToken } from '@exodra/context';
import type { ICNS, TCNSNeuron } from '@cnstra/types';

export const CNS_EXODRA_CONTEXT = exoContextToken<ICNS<TCNSNeuron<any>>>('cnstra.cns');
