import cronParser from 'cron-parser';
import type { TCNSJobSchedule } from '../types/TCNSJobSchedule';

export class CNSJobScheduleSlots {
    static buildJobId(scheduleId: string, slot: number): string {
        return `cron:${scheduleId}:${slot}`;
    }

    static list(schedule: TCNSJobSchedule, after: number, until: number, limit = 1000): number[] {
        const { scheduleId, cron, everyMs, startAt, maxRuns } = schedule;
        if ((cron === undefined) === (everyMs === undefined)) {
            throw new Error(`[@cnstra/jobs] schedule "${scheduleId}" needs exactly one of cron or everyMs`);
        }
        if (maxRuns !== undefined && startAt === undefined) {
            throw new Error(`[@cnstra/jobs] schedule "${scheduleId}" needs startAt to count maxRuns`);
        }

        const last = Math.min(until, schedule.endAt ?? Infinity);
        const inWindow = (slot: number) => slot > after && slot <= last;

        if (everyMs !== undefined) {
            if (everyMs <= 0) throw new Error(`[@cnstra/jobs] schedule "${scheduleId}" needs everyMs > 0`);
            const start = startAt ?? 0;
            const firstIndex = after < start ? 0 : Math.floor((after - start) / everyMs) + 1;
            const slots: number[] = [];
            for (let index = firstIndex; slots.length < limit; index++) {
                if (maxRuns !== undefined && index >= maxRuns) break;
                const slot = start + index * everyMs;
                if (slot > last) break;
                if (inWindow(slot)) slots.push(slot);
            }
            return slots;
        }

        const countFromStart = maxRuns !== undefined && startAt !== undefined;
        const from = countFromStart ? startAt - 1 : Math.max(after, (startAt ?? -Infinity) - 1);
        const expression = cronParser.parseExpression(cron as string, { currentDate: new Date(from), tz: schedule.tz });
        const slots: number[] = [];
        let seen = 0;
        while (slots.length < limit) {
            if (countFromStart && seen >= maxRuns) break;
            const slot = expression.next().getTime();
            seen++;
            if (slot > last) break;
            if (inWindow(slot)) slots.push(slot);
        }
        return slots;
    }
}
