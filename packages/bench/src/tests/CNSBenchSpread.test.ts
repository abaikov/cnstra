import { CNSBenchSpread } from '../CNSBenchSpread';
import type { TCNSBenchReport } from '../types/TCNSBenchReport';

/**
 * The table every threshold is built from. What it must get right: keys that the
 * comparator can look up directly, percent for the metrics compared in percent
 * and exponent units for the one compared in exponent units, and — the point of
 * the class — nothing at all when there is only one recording, because a zero
 * would read as "this metric never moves".
 */

const report = (
    over: {
        cases?: Partial<TCNSBenchReport['cases'][number]>[];
        ratios?: Partial<TCNSBenchReport['ratios'][number]>[];
        scalings?: Partial<TCNSBenchReport['scalings'][number]>[];
    } = {}
): TCNSBenchReport =>
    ({
        schemaVersion: 2,
        createdAt: '2026-09-15T00:00:00.000Z',
        machine: { key: 'test' },
        options: {},
        cases: (over.cases ?? []).map(c => ({
            id: 'c',
            medianNs: 100,
            allocationBytes: 1000,
            allocationExact: true,
            rmadPercent: 1,
            ...c,
        })),
        ratios: (over.ratios ?? []).map(r => ({ id: 'r', ratio: 2, ...r })),
        scalings: (over.scalings ?? []).map(s => ({
            family: 'f',
            exponent: 1,
            ...s,
        })),
        spread: {},
    } as unknown as TCNSBenchReport);

describe('CNSBenchSpread', () => {
    it('says nothing when there is only one recording', () => {
        // Not zero. Zero would widen no threshold and read as a measurement.
        expect(
            CNSBenchSpread.of([report({ cases: [{ id: 'a', medianNs: 100 }] })])
        ).toEqual({});
        expect(CNSBenchSpread.of([])).toEqual({});
    });

    it('reports a timing range as a percentage of the median', () => {
        const spread = CNSBenchSpread.of([
            report({ cases: [{ id: 'a', medianNs: 100 }] }),
            report({ cases: [{ id: 'a', medianNs: 150 }] }),
            report({ cases: [{ id: 'a', medianNs: 200 }] }),
        ]);

        // range 100, median 150.
        expect(spread['case:a']).toBeCloseTo((100 / 150) * 100, 5);
    });

    it('keys allocations separately from timings', () => {
        const spread = CNSBenchSpread.of([
            report({ cases: [{ id: 'a', medianNs: 100, allocationBytes: 1000 }] }),
            report({ cases: [{ id: 'a', medianNs: 100, allocationBytes: 1010 }] }),
        ]);

        expect(spread['case:a']).toBe(0);
        expect(spread['alloc:a']).toBeCloseTo((10 / 1005) * 100, 5);
    });

    it('ignores an allocation the probe could not measure exactly', () => {
        // An inexact count is a lower bound; the distance between a bound and a
        // measurement is not instability of the metric.
        const spread = CNSBenchSpread.of([
            report({
                cases: [
                    { id: 'a', allocationBytes: 1000, allocationExact: true },
                ],
            }),
            report({
                cases: [
                    { id: 'a', allocationBytes: 40, allocationExact: false },
                ],
            }),
        ]);

        expect(spread['alloc:a']).toBeUndefined();
    });

    it('reports a growth exponent as an absolute difference', () => {
        const spread = CNSBenchSpread.of([
            report({ scalings: [{ family: 'chain', exponent: 0.95 }] }),
            report({ scalings: [{ family: 'chain', exponent: 1.01 }] }),
        ]);

        // Exponents are compared in exponent units, so their spread is one too.
        expect(spread['scaling:chain']).toBeCloseTo(0.06, 5);
    });

    it('reports ratios, which are compared on every machine', () => {
        const spread = CNSBenchSpread.of([
            report({ ratios: [{ id: 'listener', ratio: 1.54 }] }),
            report({ ratios: [{ id: 'listener', ratio: 2.53 }] }),
        ]);

        // The real numbers from three recordings of unchanged code: a ratio with
        // a 20% gate that moved 48% on its own.
        expect(spread['ratio:listener']).toBeGreaterThan(40);
    });

    it('skips a metric that only one recording carries', () => {
        const spread = CNSBenchSpread.of([
            report({ cases: [{ id: 'a' }, { id: 'b' }] }),
            report({ cases: [{ id: 'a' }] }),
        ]);

        expect(spread['case:a']).toBe(0);
        expect(spread['case:b']).toBeUndefined();
    });
});
