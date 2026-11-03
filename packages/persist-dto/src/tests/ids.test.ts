import { buildCNSAttemptId, buildCNSCloneId } from '.././ids';

describe('buildCNSAttemptId', () => {
    it('joins the stimulation id and the attempt number with a #', () => {
        expect(buildCNSAttemptId('order-42', 1)).toBe('order-42#1');
        expect(buildCNSAttemptId('order-42', 12)).toBe('order-42#12');
    });

    it('is the grammar the whole stack agrees on, so it must stay stable', () => {
        // Producers, the server and the panel all parse this shape. Changing the
        // separator silently orphans every stored attempt.
        expect(buildCNSAttemptId('a', 1)).toMatch(/^a#1$/);
    });

    it('leaves a stimulation id containing a # unambiguous from the right', () => {
        // Ids come from user-chosen keys (a BullMQ jobId, an order id), so a '#'
        // inside one is possible; the attempt number is the segment after the LAST '#'.
        const id = buildCNSAttemptId('order#7', 3);
        expect(id.slice(id.lastIndexOf('#') + 1)).toBe('3');
    });
});

describe('buildCNSCloneId', () => {
    it('derives a fresh id from the source id', () => {
        expect(buildCNSCloneId('order-42')).toMatch(/^order-42-clone-\d+-[0-9a-z]+$/);
    });

    it('keeps the source id readable in the clone', () => {
        expect(buildCNSCloneId('order-42').startsWith('order-42-clone-')).toBe(true);
    });

    it('does NOT collide for two clones minted in the same millisecond', () => {
        // The whole reason the id carries a sequence beside the timestamp: two
        // clones of one run inside a millisecond used to get the same
        // stimulationId, and the second silently upserted over the first.
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        try {
            const first = buildCNSCloneId('order-42');
            const second = buildCNSCloneId('order-42');
            expect(first).not.toBe(second);
            expect(first.startsWith('order-42-clone-1700000000000-')).toBe(true);
            expect(second.startsWith('order-42-clone-1700000000000-')).toBe(true);
        } finally {
            now.mockRestore();
        }
    });

    it('stays unique across many clones of the same run in one millisecond', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
        try {
            const ids = new Set(
                Array.from({ length: 500 }, () => buildCNSCloneId('order-42'))
            );
            expect(ids.size).toBe(500);
        } finally {
            now.mockRestore();
        }
    });
});
