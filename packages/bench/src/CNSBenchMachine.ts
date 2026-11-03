import os from 'node:os';

import type { TCNSBenchMachineInfo } from './types/TCNSBenchMachineInfo';

/**
 * Describes the machine a report was produced on, and decides whether two
 * reports' absolute timings may be compared at all.
 *
 * A nanosecond figure from one laptop says nothing about another laptop, and
 * says little about the same laptop on a different Node major. Rather than let
 * a comparison quietly mislead, the identity is recorded and checked.
 */
export class CNSBenchMachine {
    static describe(): TCNSBenchMachineInfo {
        const cpus = os.cpus();
        const cpuModel = cpus[0]?.model?.trim() ?? 'unknown-cpu';
        const nodeVersion = process.versions.node;
        const nodeMajor = nodeVersion.split('.')[0] ?? '0';
        return {
            key: CNSBenchMachine.slug(
                `${process.platform}-${process.arch}-${cpuModel}-node${nodeMajor}`
            ),
            platform: process.platform,
            arch: process.arch,
            cpuModel,
            cpuCount: cpus.length,
            totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
            nodeVersion,
            v8Version: process.versions.v8,
        };
    }

    /**
     * Do these two reports come from the same machine and runtime?
     *
     * Compared on the key alone: it already folds in platform, architecture, CPU
     * model and Node major, which are the four things that move an absolute
     * timing enough to matter.
     */
    static isSame(a: TCNSBenchMachineInfo, b: TCNSBenchMachineInfo): boolean {
        return a.key === b.key;
    }

    private static slug(value: string): string {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}
