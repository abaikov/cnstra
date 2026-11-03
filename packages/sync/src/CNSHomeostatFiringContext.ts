import type { ICNSHomeostatCorrectionRepository } from './interfaces/ICNSHomeostatCorrectionRepository';

export class CNSHomeostatFiringContext {
    public readonly homeostatCorrectionRepository: ICNSHomeostatCorrectionRepository<readonly unknown[]>;

    public readonly keyHash: string;

    public readonly startedAtMs: number;

    public readonly invalidationNumber: number;

    public readonly getNowMs: () => number;

    public constructor(
        homeostatCorrectionRepository: ICNSHomeostatCorrectionRepository<readonly unknown[]>,
        keyHash: string,
        startedAtMs: number,
        invalidationNumber: number,
        getNowMs: () => number
    ) {
        this.homeostatCorrectionRepository = homeostatCorrectionRepository;
        this.keyHash = keyHash;
        this.startedAtMs = startedAtMs;
        this.invalidationNumber = invalidationNumber;
        this.getNowMs = getNowMs;
    }
}
