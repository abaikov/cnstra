import {
    encodeCNSRosterCursor,
    keysetPage,
} from '.././CNSStimulationRosterCompute';
import type { TCNSStimulationRosterRow } from '@cnstra/persist-dto';

/** A roster row at a given (startedAt, stimulationId) keyset position. */
function row(
    startedAt: number,
    stimulationId: string,
    status: TCNSStimulationRosterRow['status'] = 'running'
): TCNSStimulationRosterRow {
    return {
        stimulationId,
        scopeName: 'app',
        entry: { collateralName: 'tick', payload: undefined },
        status,
        startedAt,
        completedAt: status === 'running' ? null : startedAt + 1,
        hopCount: 1,
        hasError: status === 'failed',
    };
}

/** Newest-first, the order `keysetPage` is contracted to be handed. */
const sorted = (rows: TCNSStimulationRosterRow[]) =>
    [...rows].sort(
        (a, b) =>
            b.startedAt - a.startedAt ||
            (a.stimulationId < b.stimulationId ? 1 : -1)
    );

const page1 = sorted([
    row(500, 's5'),
    row(400, 's4'),
    row(300, 's3'),
    row(200, 's2'),
    row(100, 's1'),
]);

test('a normal page-2 request still starts right after the cursor row', () => {
    const first = keysetPage(page1, { limit: 2 });
    expect(first.rows.map(r => r.stimulationId)).toEqual(['s5', 's4']);
    expect(first.total).toBe(5);
    expect(first.nextCursor).toBe(encodeCNSRosterCursor(page1[1]!));

    const second = keysetPage(page1, {
        cursor: first.nextCursor!,
        limit: 2,
    });
    expect(second.rows.map(r => r.stimulationId)).toEqual(['s3', 's2']);
    expect(second.total).toBe(5);
    expect(second.nextCursor).toBe(encodeCNSRosterCursor(page1[3]!));

    const third = keysetPage(page1, { cursor: second.nextCursor!, limit: 2 });
    expect(third.rows.map(r => r.stimulationId)).toEqual(['s1']);
    expect(third.nextCursor).toBeNull(); // last page
});

test('a cursor whose row has left the set pages FORWARD, never back to page 1', () => {
    const first = keysetPage(page1, { limit: 2 });
    const cursor = first.nextCursor!;

    // `s4` finished and so dropped out of a `status: 'running'` filter (a bounded
    // store evicting it looks identical). Its key is still a valid position.
    const afterCompletion = page1.filter(r => r.stimulationId !== 's4');

    const second = keysetPage(afterCompletion, { cursor, limit: 2 });
    expect(second.rows.map(r => r.stimulationId)).toEqual(['s3', 's2']);
    // The bug: `findIndex` missed and `start` stayed 0, re-serving page 1 forever.
    expect(second.rows.map(r => r.stimulationId)).not.toContain('s5');
    expect(second.total).toBe(4); // the whole filtered set, not the page
    expect(second.nextCursor).toBe(
        encodeCNSRosterCursor(afterCompletion.find(r => r.stimulationId === 's2')!)
    );
});

test('a scroll whose cursor row vanishes every round still terminates, with no row served twice', () => {
    // Walk the set the way the panel does, and let the row the cursor names drop
    // out between every request — exactly the `status: 'running'` churn. Rows
    // already served stay in the set, so restarting at index 0 shows up as a
    // duplicate rather than being masked by the removal.
    let rows = [...page1];
    let cursor: string | null | undefined = undefined;
    const seen: string[] = [];
    for (let guard = 0; guard < 10; guard++) {
        const page: ReturnType<typeof keysetPage> = keysetPage(rows, {
            cursor: cursor ?? undefined,
            limit: 2,
        });
        seen.push(...page.rows.map(r => r.stimulationId));
        cursor = page.nextCursor;
        if (!cursor) break;
        const vanished = page.rows[page.rows.length - 1]!.stimulationId;
        rows = rows.filter(r => r.stimulationId !== vanished);
    }
    expect(seen).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(cursor).toBeNull(); // reached the end
});

test('ties on startedAt break by stimulationId descending', () => {
    const tied = sorted([
        row(300, 'b'),
        row(300, 'a'),
        row(300, 'c'),
        row(200, 'z'),
    ]);
    expect(tied.map(r => r.stimulationId)).toEqual(['c', 'b', 'a', 'z']);

    // Cursor at (300, 'b') — and 'b' itself gone.
    const cursor = encodeCNSRosterCursor(row(300, 'b'));
    const withoutB = tied.filter(r => r.stimulationId !== 'b');
    expect(
        keysetPage(withoutB, { cursor, limit: 5 }).rows.map(
            r => r.stimulationId
        )
    ).toEqual(['a', 'z']);
});

test('an unreadable cursor starts from the top rather than emptying the page', () => {
    const garbage = Buffer.from('not-a-keyset', 'utf8').toString('base64');
    const page = keysetPage(page1, { cursor: garbage, limit: 2 });
    expect(page.rows.map(r => r.stimulationId)).toEqual(['s5', 's4']);
    expect(page.total).toBe(5);
});

describe('a page bounded by sinceCursor', () => {
    it('keeps the rows at or newer than the cursor, newest first, and counts the whole set as total', () => {
        const boundary = encodeCNSRosterCursor(row(300, 's3'));
        const head = keysetPage([row(600, 's6'), ...page1], { sinceCursor: boundary, limit: 10 });
        expect(head.rows.map(r => r.stimulationId)).toEqual(['s6', 's5', 's4', 's3']);
        expect(head.nextCursor).toBeNull();
        expect(head.total).toBe(6);
    });

    it('says there is more between the head and the boundary when the limit cuts it', () => {
        const head = keysetPage(page1, { sinceCursor: encodeCNSRosterCursor(row(200, 's2')), limit: 2 });
        expect(head.rows.map(r => r.stimulationId)).toEqual(['s5', 's4']);
        expect(head.nextCursor).not.toBeNull();
    });

    it('breaks a tie on startedAt by stimulationId, so a run that started in the same millisecond stays on its side', () => {
        const rows = sorted([row(300, 's3b'), row(300, 's3a'), row(200, 's2')]);
        const head = keysetPage(rows, { sinceCursor: encodeCNSRosterCursor(row(300, 's3b')), limit: 10 });
        expect(head.rows.map(r => r.stimulationId)).toEqual(['s3b']);
    });
});
