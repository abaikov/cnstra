export interface ICNSHomeostatFiringPolicy {
    isFiringAllowed(): boolean;
    isRefiringAllowed(): boolean;
}
