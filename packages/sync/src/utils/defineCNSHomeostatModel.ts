import type { ICNSCollateral } from '@cnstra/types';
import { CNSHomeostatModelDefinition } from '../CNSHomeostatModelDefinition';

export function defineCNSHomeostatModel(): CNSHomeostatModelDefinition<{}, {}, {}>;
export function defineCNSHomeostatModel<TAxon extends Record<string, ICNSCollateral<unknown>>>(axon: TAxon): CNSHomeostatModelDefinition<TAxon, {}, {}>;
export function defineCNSHomeostatModel<TAxon extends Record<string, ICNSCollateral<unknown>>>(axon?: TAxon): CNSHomeostatModelDefinition<TAxon | {}, {}, {}> {
    return new CNSHomeostatModelDefinition<TAxon | {}, {}, {}>(axon ?? {});
}
