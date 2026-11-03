import type { TCNSExplorerScheduled } from './explorerClient';

export class CNSScheduledPager {
    private version = 0;
    private expanded = false;

    constructor(
        private readonly target: {
            getValue(): TCNSExplorerScheduled | null;
            setValue(page: TCNSExplorerScheduled): void;
        },
        private readonly fetch: (cursor?: string) => Promise<TCNSExplorerScheduled>
    ) {}

    reset(): void {
        this.version++;
        this.expanded = false;
    }

    async refresh(): Promise<void> {
        if (this.expanded) return;
        const mine = ++this.version;
        const page = await this.fetch().catch(() => undefined);
        if (!page || mine !== this.version) return;
        if (JSON.stringify(page) !== JSON.stringify(this.target.getValue())) this.target.setValue(page);
    }

    async more(): Promise<void> {
        const current = this.target.getValue();
        if (!current?.nextCursor) return;
        const mine = ++this.version;
        this.expanded = true;
        const page = await this.fetch(current.nextCursor).catch(() => undefined);
        if (mine !== this.version) return;
        if (!page) {
            this.expanded = false;
            return;
        }
        this.target.setValue({ ...page, rows: [...current.rows, ...page.rows], schedules: current.schedules, types: current.types });
    }
}
