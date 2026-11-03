import { describe, expect, it } from '@jest/globals';
import { CNSJobScheduleSlots } from '../schedule/CNSJobScheduleSlots';

const HOUR = 3_600_000;
const DAY_UTC = Date.UTC(2026, 9, 31);

describe('CNSJobScheduleSlots', () => {
    it('lists everyMs slots aligned to startAt within (after, until]', () => {
        const slots = CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 100, startAt: 50 }, 150, 450);

        expect(slots).toEqual([250, 350, 450]);
    });

    it('stops everyMs slots at maxRuns counted from startAt and at endAt', () => {
        expect(CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 100, startAt: 0, maxRuns: 3 }, 50, 10_000)).toEqual([100, 200]);
        expect(CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 100, startAt: 0, endAt: 250 }, -1, 10_000)).toEqual([0, 100, 200]);
    });

    it('lists cron slots in the schedule time zone', () => {
        const slots = CNSJobScheduleSlots.list({ scheduleId: 's', cron: '0 9 * * *', tz: 'Europe/Berlin' }, DAY_UTC, DAY_UTC + 24 * HOUR);

        expect(slots).toEqual([DAY_UTC + 8 * HOUR]);
    });

    it('counts cron maxRuns from startAt, not from the window', () => {
        const schedule = { scheduleId: 's', cron: '0 * * * *', tz: 'UTC', startAt: DAY_UTC, maxRuns: 3 };

        expect(CNSJobScheduleSlots.list(schedule, DAY_UTC + HOUR, DAY_UTC + 10 * HOUR)).toEqual([DAY_UTC + 2 * HOUR]);
    });

    it('respects the limit', () => {
        expect(CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 1 }, 0, 1_000_000, 5)).toHaveLength(5);
    });

    it('rejects a schedule with both or neither of cron and everyMs, and maxRuns without startAt', () => {
        expect(() => CNSJobScheduleSlots.list({ scheduleId: 's' }, 0, 1)).toThrow('exactly one');
        expect(() => CNSJobScheduleSlots.list({ scheduleId: 's', cron: '* * * * *', everyMs: 5 }, 0, 1)).toThrow('exactly one');
        expect(() => CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 5, maxRuns: 2 }, 0, 1)).toThrow('startAt');
        expect(() => CNSJobScheduleSlots.list({ scheduleId: 's', everyMs: 0 }, 0, 1)).toThrow('everyMs > 0');
    });

    it('builds a slot job id from the schedule id and the slot epoch ms', () => {
        expect(CNSJobScheduleSlots.buildJobId('daily', 1234)).toBe('cron:daily:1234');
    });
});
