import type { TCNSHomeostatRefractoryPolicy } from './TCNSHomeostatRefractoryPolicy';

export type TCNSHomeostatStaleTimeRefetchPolicyOptions = {
    staleTimeMs: number;
    homeostatRefractoryPolicy?: TCNSHomeostatRefractoryPolicy;
};
