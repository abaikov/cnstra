import { sanitizeFilters } from '../utils/filterSanitizer';

describe('sanitizeFilters', () => {
    it('keeps valid numbers and clamps negatives/NaN', () => {
        expect(
            sanitizeFilters({
                fromTimestamp: -10,
                toTimestamp: 20,
                offset: -1,
                limit: 0,
            })
        ).toEqual({
            fromTimestamp: 0,
            toTimestamp: 20,
            offset: 0,
            limit: 1,
        });
    });

    it('swaps from/to if from > to', () => {
        expect(
            sanitizeFilters({ fromTimestamp: 200, toTimestamp: 100 })
        ).toEqual({
            fromTimestamp: 100,
            toTimestamp: 200,
        });
    });

    it('ignores non-finite values', () => {
        expect(
            sanitizeFilters({
                fromTimestamp: Number.NaN,
                toTimestamp: Number.POSITIVE_INFINITY,
            })
        ).toEqual({});
    });
});
