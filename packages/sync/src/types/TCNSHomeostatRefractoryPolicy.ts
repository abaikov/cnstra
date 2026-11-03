export type TCNSHomeostatRefractoryPolicy = {
    initialDelayMs: number;
    multiplier: number;
    maxDelayMs: number;
    jitter?: number;
};
