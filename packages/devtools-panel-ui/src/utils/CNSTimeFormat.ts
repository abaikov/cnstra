const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class CNSTimeFormat {
    public static timeOf(timestampMs: number): string {
        return new Date(timestampMs).toLocaleTimeString();
    }

    public static stampOf(timestampMs: number): string {
        return new Date(timestampMs).toLocaleString();
    }

    public static axisLabelOf(timestampMs: number, spanMs: number): string {
        const date = new Date(timestampMs);
        const day = `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
        if (spanMs >= 3 * 864e5) return day;
        if (spanMs >= 12 * 36e5) return `${day} ${CNSTimeFormat.hoursMinutesOf(date)}`;
        if (spanMs >= 30 * 6e4) return CNSTimeFormat.hoursMinutesOf(date);
        return date.toLocaleTimeString();
    }

    private static hoursMinutesOf(date: Date): string {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
}
