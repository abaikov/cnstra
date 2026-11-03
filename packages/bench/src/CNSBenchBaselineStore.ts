import fs from 'node:fs';
import path from 'node:path';

import { CNSBenchMachine } from './CNSBenchMachine';
import type { TCNSBenchReport } from './types/TCNSBenchReport';

/**
 * Where recorded baselines live, and how one is found again.
 *
 * A baseline is filed under the machine that produced it
 * (`darwin-arm64-<cpu>-node22.json`), for a blunt reason: absolute timings from
 * one machine are meaningless on another, and a single shared `baseline.json`
 * would guarantee that whoever ran it last made everyone else's comparison a
 * lie. Two people on two laptops keep two files and never collide.
 *
 * The directory is git-ignored by default (see `packages/bench/.gitignore`).
 * Committing a laptop's absolute numbers would hand every other machine a
 * permanent set of false regressions. What IS portable — the option-cost ratios
 * and the growth exponents — is judged by the comparator on every machine, so a
 * shared baseline can still be committed deliberately and pointed at with
 * `--baseline <path>`; the absolute half is then skipped and said to be skipped.
 */
export class CNSBenchBaselineStore {
    constructor(
        private readonly directory: string = CNSBenchBaselineStore.defaultDirectory()
    ) {}

    /** `packages/bench/baselines`, resolved from this file rather than from cwd. */
    static defaultDirectory(): string {
        const here = __dirname;
        return path.resolve(here, '..', 'baselines');
    }

    /** The path this machine's baseline would occupy, whether or not it exists. */
    pathForThisMachine(): string {
        return path.join(this.directory, `${CNSBenchMachine.describe().key}.json`);
    }

    save(report: TCNSBenchReport, targetPath?: string): string {
        const destination = targetPath ?? this.pathForThisMachine();
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(
            destination,
            `${JSON.stringify(report, null, 2)}\n`,
            'utf8'
        );
        return destination;
    }

    /** Read a baseline, or `undefined` when there is none to read. */
    load(sourcePath?: string): TCNSBenchReport | undefined {
        const source = sourcePath ?? this.pathForThisMachine();
        if (!fs.existsSync(source)) return undefined;
        return JSON.parse(fs.readFileSync(source, 'utf8')) as TCNSBenchReport;
    }
}
