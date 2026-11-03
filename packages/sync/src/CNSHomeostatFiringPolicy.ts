import type { ICNSHomeostatFiringPolicy } from './interfaces/ICNSHomeostatFiringPolicy';
import type { TCNSHomeostatFiringPolicyOptions } from './types/TCNSHomeostatFiringPolicyOptions';

export class CNSHomeostatFiringPolicy implements ICNSHomeostatFiringPolicy {
    private readonly isOnline: () => boolean;

    private readonly isVisible: () => boolean;

    public constructor(options: TCNSHomeostatFiringPolicyOptions = {}) {
        this.isOnline = options.isOnline ?? (() => true);
        this.isVisible = options.isVisible ?? (() => true);
    }

    public isFiringAllowed(): boolean {
        return this.isOnline();
    }

    public isRefiringAllowed(): boolean {
        return this.isOnline() && this.isVisible();
    }
}
