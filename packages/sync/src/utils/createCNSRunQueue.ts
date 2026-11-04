import { runAll } from './runAll';

export function createCNSRunQueue(scheduleRunQueued: (runQueued: () => void) => void): (run: () => void) => void {
    let runs: (() => void)[] = [];
    const runQueued = () => {
        const queuedRuns = runs;
        runs = [];
        runAll(queuedRuns);
    };
    return run => {
        if (runs.push(run) === 1) scheduleRunQueued(runQueued);
    };
}
