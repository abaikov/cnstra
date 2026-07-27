import { CNSDTOApp } from "@cnstra/devtools-dto";
import type { ICNSDevToolsServerRepository, CNSDTOTopologySnapshot } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    private apps = new Map<string, CNSDTOApp>();
    private topologies = new Map<string, CNSDTOTopologySnapshot>(); // cnsId → snapshot
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
        this.cnsToApp.clear();
        this.appToCns.clear();
    }
}
