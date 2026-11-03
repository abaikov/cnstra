import { CNSBenchComparator } from '../CNSBenchComparator';
import type { TCNSBenchComparisonEntry } from '../types/TCNSBenchComparison';
import type { TCNSBenchReport } from '../types/TCNSBenchReport';

/**
 * The gate cried wolf: two `bench:compare` runs of unchanged code against the
 * same baseline flagged three regressions and then eight, a different set each
 * time. The cause was where the threshold came from — the spread of the samples
 * INSIDE a run, which for the worst offenders is a fraction of a percent while
 * their run-to-run swing is tens of percent.
 *
 * The case below is the real one. `observe/response-listener` measured
 * `rmadPercent` 1.0 and moved 86.7% between three recordings of the same code.
 * These pin that a recorded spread widens the gate and an unrecorded one does
 * not silently pretend to.
 */

const machine = {
    key: 'darwin-arm64-test-node24',
    platform: 'darwin',
    arch: 'arm64',
    cpu: 'test',
    nodeMajor: 24,
};

const report = (
    medianNs: number,
    spread: Record<string, number> = {}
): TCNSBenchReport =>
    ({
        schemaVersion: 2,
        createdAt: '2026-09-15T00:00:00.000Z',
        machine,
        options: {},
        cases: [
            {
                id: 'observe/response-listener',
                medianNs,
                // Stable inside the run — which is exactly the trap.
                rmadPercent: 1,
                allocationBytes: 7947,
                allocationExact: true,
            },
        ],
        ratios: [],
        scalings: [],
        spread,
    } as unknown as TCNSBenchReport);

const caseEntry = (comparison: {
    entries: TCNSBenchComparisonEntry[];
}): TCNSBenchComparisonEntry =>
    comparison.entries.find(
        e => e.metric === 'case:observe/response-listener'
    )!;

describe('where a case threshold comes from', () => {
    it('does not fail a case for its own recorded run-to-run swing', () => {
        // +40% on a case that moves 86.7% by itself, with nothing changed.
        const baseline = report(1625, {
            'case:observe/response-listener': 86.7,
        });
        const current = report(Math.round(1625 * 1.4));

        const entry = caseEntry(
            new CNSBenchComparator().compare(baseline, current)
        );

        expect(entry.verdict).not.toBe('regression');
        expect(entry.threshold).toBeCloseTo(173.4, 1);
        expect(entry.note).toContain('recorded run-to-run spread');
    });

    it('still fails a move that clears even that', () => {
        // The gate is democratic, not absent: 3x is past 86.7% twice over.
        const baseline = report(1625, {
            'case:observe/response-listener': 86.7,
        });
        const current = report(1625 * 3);

        expect(
            caseEntry(new CNSBenchComparator().compare(baseline, current))
                .verdict
        ).toBe('regression');
    });

    it('keeps the tight gate on a case that is actually stable', () => {
        // 0.4% recorded spread: the configured 25% wins, so a real +40% fails.
        const baseline = report(1625, {
            'case:observe/response-listener': 0.4,
        });
        const current = report(Math.round(1625 * 1.4));

        const entry = caseEntry(
            new CNSBenchComparator().compare(baseline, current)
        );

        expect(entry.verdict).toBe('regression');
        expect(entry.threshold).toBe(25);
    });

    it('says so when the baseline recorded no spread for the metric', () => {
        // A single-run baseline. It still gates, on the within-run floor as
        // before — but the note no longer implies the spread was measured.
        const baseline = report(1625);
        const current = report(Math.round(1625 * 1.4));

        const entry = caseEntry(
            new CNSBenchComparator().compare(baseline, current)
        );

        expect(entry.verdict).toBe('regression');
        expect(entry.note).toBeUndefined();
    });

    it('refuses a baseline recorded against the old shape', () => {
        const old = {
            ...report(1625),
            schemaVersion: 1,
        } as unknown as TCNSBenchReport;

        expect(() => new CNSBenchComparator().compare(old, report(1625)))
            .toThrow(/Record a fresh baseline/);
    });
});

describe('where an allocation threshold comes from', () => {
    it('widens on a recorded spread the same way', () => {
        const baseline = report(1625, {
            'alloc:observe/response-listener': 20,
        });
        const current = {
            ...report(1625),
            cases: [
                {
                    ...report(1625).cases[0],
                    allocationBytes: Math.round(7947 * 1.3),
                },
            ],
        } as TCNSBenchReport;

        const entry = new CNSBenchComparator()
            .compare(baseline, current)
            .entries.find(
                e => e.metric === 'alloc:observe/response-listener'
            )!;

        expect(entry.threshold).toBe(40);
        expect(entry.verdict).not.toBe('regression');
    });

    it('stays at the configured 10% when the recording was stable', () => {
        // Which is the normal case: 21 of 22 metrics held to within 1.1%.
        const baseline = report(1625, {
            'alloc:observe/response-listener': 0.1,
        });
        const current = {
            ...report(1625),
            cases: [
                {
                    ...report(1625).cases[0],
                    allocationBytes: Math.round(7947 * 1.3),
                },
            ],
        } as TCNSBenchReport;

        const entry = new CNSBenchComparator()
            .compare(baseline, current)
            .entries.find(
                e => e.metric === 'alloc:observe/response-listener'
            )!;

        expect(entry.threshold).toBe(10);
        expect(entry.verdict).toBe('regression');
    });
});
