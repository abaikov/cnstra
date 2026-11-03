import type { TCNSStimulationRowDTO } from '@cnstra/devtools-dto';
import type { TCNSExplorerSnapshot } from './explorerClient';

/**
 * What the panel already holds of the run snapshot, and what it therefore does
 * not need sent again.
 *
 * The snapshot poll runs every two seconds and used to carry the whole page's
 * attempts and tasks each time. Under `'full'` volume a run contributes one task
 * row per hop, so a page of two hundred fifty-hop runs is ten thousand rows read,
 * serialised and pushed every two seconds — and almost all of them byte-identical
 * to the last push, because a finished run never changes again.
 *
 * So the poll names the runs it already has ({@link CNSSnapshotCache.skipDetailFor})
 * and the server omits their details. Two rules keep that honest:
 *
 *  - A run is only skipped while its ROW is unchanged since the details were
 *    taken. Rows always arrive in full — there are at most a page of them — and
 *    `status`, `hopCount` and `completedAt` moving is exactly what "this run did
 *    something" means. A retry moves them, so a retried run's details come back
 *    on the next poll without anyone having to invalidate anything.
 *  - Details are kept only for runs in the newest page. The page is the working
 *    set; a run that scrolled out of it takes its tasks with it, so the store
 *    cannot grow past what the page bounds.
 */
export class CNSSnapshotCache {
    /**
     * The row as it looked when this run's details were last taken. Not the
     * current row: the merge replaces rows even for runs whose details it
     * skipped, so comparing against the current one would compare a row with
     * itself and skip forever.
     */
    private readonly detailTakenAt = new Map<string, string>();

    private held: TCNSExplorerSnapshot = {
        stimulations: [],
        attempts: [],
        tasks: [],
    };

    /** What `status`, `hopCount` and `completedAt` say the run has done so far. */
    private static fingerprint(row: TCNSStimulationRowDTO): string {
        return `${row.status}|${row.hopCount}|${row.completedAt ?? ''}`;
    }

    get snapshot(): TCNSExplorerSnapshot {
        return this.held;
    }

    /** Ids whose attempts and tasks the next poll may leave out. */
    skipDetailFor(): string[] {
        const skip: string[] = [];
        for (const row of this.held.stimulations) {
            const taken = this.detailTakenAt.get(row.stimulationId);
            if (taken !== undefined && taken === CNSSnapshotCache.fingerprint(row))
                skip.push(row.stimulationId);
        }
        return skip;
    }

    /**
     * Fold a poll's result into what is held.
     *
     * `skipped` is what was actually asked to be left out — passing it rather
     * than inferring it from absence is what lets a run with genuinely no tasks
     * be told apart from one that was not sent.
     */
    merge(
        incoming: TCNSExplorerSnapshot,
        skipped: readonly string[] = []
    ): TCNSExplorerSnapshot {
        const page = new Set(
            incoming.stimulations.map(row => row.stimulationId)
        );
        // Kept only where it was asked to be kept, and only inside the page.
        const keep = new Set(skipped.filter(id => page.has(id)));

        const attempts = [
            ...this.held.attempts.filter(a => keep.has(a.stimulationId)),
            ...incoming.attempts,
        ];
        const keptAttemptIds = new Set(
            this.held.attempts
                .filter(a => keep.has(a.stimulationId))
                .map(a => a.stimulationAttemptId)
        );
        const tasks = [
            ...this.held.tasks.filter(t =>
                keptAttemptIds.has(t.stimulationAttemptId)
            ),
            ...incoming.tasks,
        ];

        // Details are now current as of these rows — for the ones that arrived
        // with details. A skipped run keeps the fingerprint it already had.
        const rowById = new Map(
            incoming.stimulations.map(row => [row.stimulationId, row])
        );
        for (const id of [...this.detailTakenAt.keys()])
            if (!page.has(id)) this.detailTakenAt.delete(id);
        for (const [id, row] of rowById) {
            if (keep.has(id)) continue;
            this.detailTakenAt.set(id, CNSSnapshotCache.fingerprint(row));
        }

        this.held = { stimulations: incoming.stimulations, attempts, tasks };
        return this.held;
    }

    /** Forget everything — the filter changed, so the page is a different set. */
    reset(): void {
        this.detailTakenAt.clear();
        this.held = { stimulations: [], attempts: [], tasks: [] };
    }
}
