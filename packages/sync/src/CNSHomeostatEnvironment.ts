import type { CNSHomeostatReceptor } from './CNSHomeostatReceptor';
import type { CNSHomeostatRegulator } from './CNSHomeostatRegulator';
import type { ICNSHomeostatCorrectionRepository } from './interfaces/ICNSHomeostatCorrectionRepository';
import type { ICNSHomeostatFiringPolicy } from './interfaces/ICNSHomeostatFiringPolicy';
import type { TCNSHomeostasisState } from './types/TCNSHomeostasisState';
import type { TCNSHomeostatEnvironmentOptions } from './types/TCNSHomeostatEnvironmentOptions';

export class CNSHomeostatEnvironment<
    TFiringPolicy extends ICNSHomeostatFiringPolicy = ICNSHomeostatFiringPolicy,
    TCorrectionRepository extends ICNSHomeostatCorrectionRepository<readonly unknown[]> = ICNSHomeostatCorrectionRepository<readonly unknown[]>,
> {
    public readonly homeostatEnvironmentOptions: TCNSHomeostatEnvironmentOptions<TFiringPolicy, TCorrectionRepository>;

    private readonly homeostatCorrectionRepositoryByReceptor = new WeakMap<CNSHomeostatReceptor<never, unknown>, TCorrectionRepository>();

    private readonly homeostatRegulatorByReceptor = new Map<CNSHomeostatReceptor<never, unknown>, Pick<CNSHomeostatRegulator<readonly unknown[], unknown>, 'dispose'>>();

    private isDisposed = false;

    public constructor(options: TCNSHomeostatEnvironmentOptions<TFiringPolicy, TCorrectionRepository>) {
        this.homeostatEnvironmentOptions = options;
    }

    public homeostatCorrectionRepositoryOf(homeostatReceptor: CNSHomeostatReceptor<never, unknown>): TCorrectionRepository {
        let homeostatCorrectionRepository = this.homeostatCorrectionRepositoryByReceptor.get(homeostatReceptor);
        if (homeostatCorrectionRepository === undefined) {
            homeostatCorrectionRepository = this.homeostatEnvironmentOptions.createHomeostatCorrectionRepository(homeostatReceptor);
            this.homeostatCorrectionRepositoryByReceptor.set(homeostatReceptor, homeostatCorrectionRepository);
        }
        return homeostatCorrectionRepository;
    }

    public homeostatRegulatorOf<TKey extends readonly unknown[], TData>(homeostatReceptor: CNSHomeostatReceptor<TKey, TData>): CNSHomeostatRegulator<TKey, TData> {
        let homeostatRegulator = this.homeostatRegulatorByReceptor.get(homeostatReceptor) as CNSHomeostatRegulator<TKey, TData> | undefined;
        if (homeostatRegulator !== undefined) return homeostatRegulator;
        const options = this.homeostatEnvironmentOptions;
        const homeostatCorrectionRepository = this.homeostatCorrectionRepositoryOf(homeostatReceptor);
        homeostatRegulator = options.createHomeostatRegulator<TKey, TData>({
            homeostatReceptor,
            cns: options.cns,
            homeostatCorrectionRepository,
            homeostatFiringPolicy: options.homeostatFiringPolicy,
            homeostatRefetchPolicy: options.createHomeostatRefetchPolicy(homeostatReceptor),
            stimulationOptions: options.stimulationOptionsOf(homeostatReceptor),
            getNowMs: options.getNowMs,
            keyHashFn: options.keyHashFn,
            runUntracked: options.runUntracked,
            runInTransaction: options.runInTransaction,
            scheduleRefetchAt: (keyHash, refetchAtMs, refetch) => options.scheduleRefetchAt(homeostatCorrectionRepository, keyHash, refetchAtMs, refetch),
        });
        this.homeostatRegulatorByReceptor.set(homeostatReceptor, homeostatRegulator);
        if (this.isDisposed) homeostatRegulator.dispose();
        return homeostatRegulator;
    }

    public dispose(): void {
        this.isDisposed = true;
        for (const homeostatRegulator of this.homeostatRegulatorByReceptor.values()) homeostatRegulator.dispose();
    }

    public invalidate<TKey extends readonly unknown[]>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, unknown>,
        key: NoInfer<TKey>
    ): Promise<TCNSHomeostasisState<TKey> | undefined> {
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        return this.runWriteAndWait(() => homeostatRegulator.invalidate(key));
    }

    public invalidateByKeyPrefix<TKey extends readonly unknown[]>(
        homeostatReceptor: CNSHomeostatReceptor<TKey, unknown>,
        keyPrefix: NoInfer<Readonly<Partial<TKey>>>
    ): Promise<(TCNSHomeostasisState<TKey> | undefined)[]> {
        const homeostatRegulator = this.homeostatRegulatorOf(homeostatReceptor);
        return this.runWriteAndWait(() => homeostatRegulator.invalidateByKeyPrefix(keyPrefix));
    }

    private runWriteAndWait<TResult>(write: () => Promise<TResult>): Promise<TResult> {
        return new Promise((resolve, reject) => this.homeostatEnvironmentOptions.runWrite(() => {
            try {
                resolve(write());
            } catch (error) {
                reject(error);
            }
        }));
    }
}
