/**
 * Where a report was produced. Absolute timings are only comparable between two
 * reports whose machines agree on every field here, so it is recorded rather
 * than assumed.
 */
export type TCNSBenchMachineInfo = {
    /**
     * `platform-arch-cpu-nodeMAJOR`, slugified. Used as the baseline filename,
     * so two machines never overwrite each other's numbers.
     */
    key: string;
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    totalMemoryMb: number;
    nodeVersion: string;
    v8Version: string;
};
