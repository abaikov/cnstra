import { CNSDTOApp, CNSDTOExecution, CNSDTOExecutionFilter, CNSDTOHop } from "@cnstra/devtools-dto";
import type { ICNSDevToolsServerRepository, CNSDTOTopologySnapshot } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    private apps = new Map<string, CNSDTOApp>();
    private topologies = new Map<string, CNSDTOTopologySnapshot>(); // cnsId → snapshot
    private executions = new Map<string, CNSDTOExecution>();        // executionId → execution
    private hops = new Map<string, CNSDTOHop[]>();                  // executionId → hops
    private cnsToApp = new Map<string, string>();             // cnsId → appId
    private appToCns = new Map<string, Set<string>>();        // appId → Set<cnsId>

    // ─── Apps ─────────────────────────────────────────────────────────────────

    upsertApp(app: CNSDTOApp): void {
        this.apps.set(app.id, app);
    }

    listApps(): CNSDTOApp[] {
        return [...this.apps.values()];
    }

    // ─── Topology ─────────────────────────────────────────────────────────────

    saveTopology(snapshot: CNSDTOTopologySnapshot): void {
        this.topologies.set(snapshot.cnsId, snapshot);
    }

    getTopology(cnsId?: string): CNSDTOTopologySnapshot[] {
        if (cnsId) {
            const s = this.topologies.get(cnsId);
            return s ? [s] : [];
        }
        return [...this.topologies.values()];
    }

    // ─── Executions ───────────────────────────────────────────────────────────

    saveExecution(execution: CNSDTOExecution): void {
        this.executions.set(execution.id, execution);
    }

    completeExecution(
        executionId: string,
        completedAt: number,
        hopCount: number,
        hasError: boolean
    ): void {
        const execution = this.executions.get(executionId);
        if (execution) {
            this.executions.set(executionId, { ...execution, completedAt, hopCount, hasError });
        }
    }

    getExecutions(
        appId: string,
        filter: CNSDTOExecutionFilter
    ): { items: CNSDTOExecution[]; total: number } {
        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;

        let all = [...this.executions.values()].filter(e => e.appId === appId);

        if (filter.fromTimestamp !== undefined)
            all = all.filter(e => e.startedAt >= filter.fromTimestamp!);
        if (filter.toTimestamp !== undefined)
            all = all.filter(e => e.startedAt <= filter.toTimestamp!);
        if (filter.hasError !== undefined)
            all = all.filter(e => e.hasError === filter.hasError);
        if (filter.collateralId !== undefined)
            all = all.filter(e => e.collateralId === filter.collateralId);
        if (filter.neuronId !== undefined)
            all = all.filter(e => e.collateralId.startsWith(filter.neuronId!));

        all.sort((a, b) => b.startedAt - a.startedAt);

        const total = all.length;
        const items = all.slice(offset, offset + limit);
        return { items, total };
    }

    // ─── Hops ─────────────────────────────────────────────────────────────────

    saveHop(hop: CNSDTOHop): void {
        if (!this.hops.has(hop.executionId)) this.hops.set(hop.executionId, []);
        this.hops.get(hop.executionId)!.push(hop);
    }

    getHops(executionId: string): CNSDTOHop[] {
        return (this.hops.get(executionId) ?? []).sort((a, b) => a.index - b.index);
    }

    // ─── CNS mapping ──────────────────────────────────────────────────────────

    addCnsToApp(appId: string, cnsId: string): void {
        this.cnsToApp.set(cnsId, appId);
        if (!this.appToCns.has(appId)) this.appToCns.set(appId, new Set());
        this.appToCns.get(appId)!.add(cnsId);
    }

    getCnsByApp(appId: string): string[] {
        return [...(this.appToCns.get(appId) ?? [])];
    }

    findAppByCns(cnsId: string): string | undefined {
        return this.cnsToApp.get(cnsId);
    }

    // ─── Utility ──────────────────────────────────────────────────────────────

    clear(): void {
        this.apps.clear();
        this.topologies.clear();
        this.executions.clear();
        this.hops.clear();
        this.cnsToApp.clear();
        this.appToCns.clear();
    }
}
