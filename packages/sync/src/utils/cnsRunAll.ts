export function cnsRunAll(runs: Iterable<() => void>): void {
    const errors: unknown[] = [];
    for (const run of runs) {
        try {
            run();
        } catch (error) {
            errors.push(error);
        }
    }
    const [firstError, ...laterErrors] = errors;
    for (const laterError of laterErrors) queueMicrotask(() => { throw laterError; });
    if (errors.length > 0) throw firstError;
}
