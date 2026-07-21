import { CNSDTOApp, CNSDTOStimulation, CNSDTOStimulationFilter, CNSDTOHop } from "@cnstra/devtools-dto";
import type { ICNSDevToolsServerRepository, CNSDTOTopologySnapshot } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    private apps = new Map<string, CNSDTOApp>();
    private topologies = new Map<string, CNSDTOTopologySnapshot>(); // cnsId → snapshot
    private stimulations = new Map<string, CNSDTOStimulation>();        // stimulationId → stimulation
    private hops = new Map<string, CNSDTOHop[]>();                  // stimulationId → hops
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

    // ─── Stimulations ───────────────────────────────────────────────────────────

    saveStimulation(stimulation: CNSDTOStimulation): void {
        this.stimulations.set(stimulation.id, stimulation);
    }

    completeStimulation(
        stimulationId: string,
        completedAt: number,
        hopCount: number,
        hasError: boolean
    ): void {
        const stimulation = this.stimulations.get(stimulationId);
        if (stimulation) {
            this.stimulations.set(stimulationId, { ...stimulation, completedAt, hopCount, hasError });
        }
    }

    getStimulations(
        appId: string,
        filter: CNSDTOStimulationFilter
    ): { items: CNSDTOStimulation[]; total: number } {
        const limit = filter.limit ?? 100;
        const offset = filter.offset ?? 0;

        let all = [...this.stimulations.values()].filter(e => e.appId === appId);

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
        if (!this.hops.has(hop.stimulationId)) this.hops.set(hop.stimulationId, []);
        this.hops.get(hop.stimulationId)!.push(hop);
    }

    getHops(stimulationId: string): CNSDTOHop[] {
        return (this.hops.get(stimulationId) ?? []).sort((a, b) => a.index - b.index);
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
        this.stimulations.clear();
        this.hops.clear();
        this.cnsToApp.clear();
        this.appToCns.clear();
    }
}
