import type { ICNSDevToolsServerRepository, TCNSTopologySnapshotDTO } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    private topologies = new Map<string, TCNSTopologySnapshotDTO>(); // cnsId → snapshot

    // ─── Topology ─────────────────────────────────────────────────────────────

    saveTopology(snapshot: TCNSTopologySnapshotDTO): void {
        this.topologies.set(snapshot.cnsId, snapshot);
    }

    getTopology(cnsId?: string): TCNSTopologySnapshotDTO[] {
        if (cnsId) {
            const s = this.topologies.get(cnsId);
            return s ? [s] : [];
        }
        return [...this.topologies.values()];
    }

    findAppByCns(cnsId: string): string | undefined {
        return this.topologies.get(cnsId)?.appId;
    }

    // ─── Utility ──────────────────────────────────────────────────────────────

    clear(): void {
        this.topologies.clear();
    }
}
