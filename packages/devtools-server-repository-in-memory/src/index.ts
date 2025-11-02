import {
    DevToolsApp,
    Neuron,
    Collateral,
    Dendrite,
    StimulationMessage,
    StimulationResponse,
} from '@cnstra/devtools-dto';
import { ICNSDevToolsServerRepository } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    // Normalized data storage
    private apps = new Map<string, DevToolsApp>();
    private neurons = new Map<string, Neuron>(); // key: neuron.id
    private collaterals = new Map<string, Collateral>(); // key: collateral.id
    private dendrites = new Map<string, Dendrite>(); // key: dendrite.id
    private stimulations = new Map<string, StimulationMessage>(); // key: stimulation.stimulationId
    private responses = new Map<string, StimulationResponse>(); // key: response.responseId

    // Indexes for efficient querying
    private neuronsByCns = new Map<string, Set<string>>(); // cnsId -> Set<neuronId>
    private collateralsByCns = new Map<string, Set<string>>(); // cnsId -> Set<collateralId>
    private dendritesByCns = new Map<string, Set<string>>(); // cnsId -> Set<dendriteId>
    private stimulationsByApp = new Map<string, Set<string>>(); // appId -> Set<stimulationId>
    private responsesByCns = new Map<string, Set<string>>(); // cnsId -> Set<responseId>

    // App management
    upsertApp(app: DevToolsApp): void {
        const existing = this.apps.get(app.appId);
        const updatedApp: DevToolsApp = {
            appId: app.appId,
            appName: app.appName,
            version: app.version,
            firstSeenAt: app.firstSeenAt || existing?.firstSeenAt || Date.now(),
            lastSeenAt: app.lastSeenAt || Date.now(),
        };
        this.apps.set(app.appId, updatedApp);
    }

    listApps(): DevToolsApp[] {
        return Array.from(this.apps.values());
    }

    // Topology management
    upsertNeuron(neuron: Neuron): void {
        this.neurons.set(neuron.id, neuron);

        // Update index
        if (!this.neuronsByCns.has(neuron.cnsId)) {
            this.neuronsByCns.set(neuron.cnsId, new Set());
        }
        this.neuronsByCns.get(neuron.cnsId)!.add(neuron.id);
    }

    upsertCollateral(collateral: Collateral): void {
        this.collaterals.set(collateral.id, collateral);

        // Update index
        if (!this.collateralsByCns.has(collateral.cnsId)) {
            this.collateralsByCns.set(collateral.cnsId, new Set());
        }
        this.collateralsByCns.get(collateral.cnsId)!.add(collateral.id);
    }

    upsertDendrite(dendrite: Dendrite): void {
        this.dendrites.set(dendrite.id, dendrite);

        // Update index
        if (!this.dendritesByCns.has(dendrite.cnsId)) {
            this.dendritesByCns.set(dendrite.cnsId, new Set());
        }
        this.dendritesByCns.get(dendrite.cnsId)!.add(dendrite.id);
    }

    removeNeuron(neuronId: string): void {
        const neuron = this.neurons.get(neuronId);
        if (neuron) {
            // Remove from index
            const cnsSet = this.neuronsByCns.get(neuron.cnsId);
            if (cnsSet) {
                cnsSet.delete(neuronId);
                if (cnsSet.size === 0) {
                    this.neuronsByCns.delete(neuron.cnsId);
                }
            }
            // Remove from main storage
            this.neurons.delete(neuronId);
        }
    }

    removeCollateral(collateralId: string): void {
        const collateral = this.collaterals.get(collateralId);
        if (collateral) {
            // Remove from index
            const cnsSet = this.collateralsByCns.get(collateral.cnsId);
            if (cnsSet) {
                cnsSet.delete(collateralId);
                if (cnsSet.size === 0) {
                    this.collateralsByCns.delete(collateral.cnsId);
                }
            }
            // Remove from main storage
            this.collaterals.delete(collateralId);
        }
    }

    removeDendrite(dendriteId: string): void {
        const dendrite = this.dendrites.get(dendriteId);
        if (dendrite) {
            // Remove from index
            const cnsSet = this.dendritesByCns.get(dendrite.cnsId);
            if (cnsSet) {
                cnsSet.delete(dendriteId);
                if (cnsSet.size === 0) {
                    this.dendritesByCns.delete(dendrite.cnsId);
                }
            }
            // Remove from main storage
            this.dendrites.delete(dendriteId);
        }
    }

    getNeuronsByCns(cnsId: string): Neuron[] {
        const neuronIds = this.neuronsByCns.get(cnsId) || new Set();
        return Array.from(neuronIds)
            .map(id => this.neurons.get(id)!)
            .filter(Boolean);
    }

    getCollateralsByCns(cnsId: string): Collateral[] {
        const collateralIds = this.collateralsByCns.get(cnsId) || new Set();
        return Array.from(collateralIds)
            .map(id => this.collaterals.get(id)!)
            .filter(Boolean);
    }

    getDendritesByCns(cnsId: string): Dendrite[] {
        const dendriteIds = this.dendritesByCns.get(cnsId) || new Set();
        return Array.from(dendriteIds)
            .map(id => this.dendrites.get(id)!)
            .filter(Boolean);
    }

    // Legacy message support
    saveMessage(message: any): void {
        // This is a legacy method for backward compatibility
        // In the new architecture, messages are handled by specific save methods
        // This implementation does nothing to avoid storing duplicate data
    }

    // Stimulation management
    saveStimulation(stimulation: StimulationMessage): void {
        this.stimulations.set(stimulation.stimulationId, stimulation);

        // Update index
        if (!this.stimulationsByApp.has(stimulation.appId)) {
            this.stimulationsByApp.set(stimulation.appId, new Set());
        }
        this.stimulationsByApp
            .get(stimulation.appId)!
            .add(stimulation.stimulationId);

        // Keep only last 1000 stimulations per app
        const appStimulations = this.stimulationsByApp.get(stimulation.appId)!;
        if (appStimulations.size > 1000) {
            const toRemove = Array.from(appStimulations).slice(
                0,
                appStimulations.size - 1000
            );
            toRemove.forEach(id => {
                appStimulations.delete(id);
                this.stimulations.delete(id);
            });
        }
    }

    getStimulationsByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            collateralName?: string;
            neuronId?: string;
        }
    ): StimulationMessage[] {
        const stimulationIds = this.stimulationsByApp.get(appId) || new Set();
        let stimulations = Array.from(stimulationIds)
            .map(id => this.stimulations.get(id)!)
            .filter(Boolean);

        if (!filters) return stimulations;

        // Apply filters
        if (filters.fromTimestamp !== undefined) {
            stimulations = stimulations.filter(
                s => s.timestamp >= filters.fromTimestamp!
            );
        }
        if (filters.toTimestamp !== undefined) {
            stimulations = stimulations.filter(
                s => s.timestamp <= filters.toTimestamp!
            );
        }
        if (filters.hasError !== undefined) {
            stimulations = stimulations.filter(s => {
                const hasError =
                    s.error !== null && s.error !== undefined && s.error !== '';
                return filters.hasError ? hasError : !hasError;
            });
        }
        if (filters.errorContains) {
            stimulations = stimulations.filter(s =>
                String(s.error || '')
                    .toLowerCase()
                    .includes(filters.errorContains!.toLowerCase())
            );
        }
        if (filters.collateralName) {
            stimulations = stimulations.filter(
                s => s.collateralName === filters.collateralName
            );
        }
        if (filters.neuronId) {
            stimulations = stimulations.filter(
                s => s.neuronId === filters.neuronId
            );
        }

        // Apply pagination
        if (filters.offset) {
            stimulations = stimulations.slice(filters.offset);
        }
        if (filters.limit) {
            stimulations = stimulations.slice(0, filters.limit);
        }

        return stimulations;
    }

    // Response management
    saveResponse(response: StimulationResponse): void {
        this.responses.set(response.responseId, response);

        // Update index
        if (!this.responsesByCns.has(response.cnsId)) {
            this.responsesByCns.set(response.cnsId, new Set());
        }
        this.responsesByCns.get(response.cnsId)!.add(response.responseId);

        // Keep only last 2000 responses per CNS
        const cnsResponses = this.responsesByCns.get(response.cnsId)!;
        if (cnsResponses.size > 2000) {
            const toRemove = Array.from(cnsResponses).slice(
                0,
                cnsResponses.size - 2000
            );
            toRemove.forEach(id => {
                cnsResponses.delete(id);
                this.responses.delete(id);
            });
        }
    }

    getResponsesByCns(
        cnsId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
            hasError?: boolean;
            errorContains?: string;
            neuronId?: string;
            collateralName?: string;
        }
    ): StimulationResponse[] {
        const responseIds = this.responsesByCns.get(cnsId) || new Set();
        let responses = Array.from(responseIds)
            .map(id => this.responses.get(id)!)
            .filter(Boolean);

        if (!filters) return responses;

        // Apply filters
        if (filters.fromTimestamp !== undefined) {
            responses = responses.filter(
                r => r.timestamp >= filters.fromTimestamp!
            );
        }
        if (filters.toTimestamp !== undefined) {
            responses = responses.filter(
                r => r.timestamp <= filters.toTimestamp!
            );
        }
        if (filters.hasError !== undefined) {
            responses = responses.filter(r => {
                const hasError =
                    r.error !== null && r.error !== undefined && r.error !== '';
                return filters.hasError ? hasError : !hasError;
            });
        }
        if (filters.errorContains) {
            responses = responses.filter(r =>
                String(r.error || '')
                    .toLowerCase()
                    .includes(filters.errorContains!.toLowerCase())
            );
        }
        if (filters.neuronId) {
            // Note: StimulationResponse doesn't have neuronId, this would need to be added or handled differently
            // For now, we'll skip this filter
        }
        if (filters.collateralName) {
            responses = responses.filter(
                r =>
                    r.inputCollateralName === filters.collateralName ||
                    r.outputCollateralName === filters.collateralName
            );
        }

        // Apply pagination
        if (filters.offset) {
            responses = responses.slice(filters.offset);
        }
        if (filters.limit) {
            responses = responses.slice(0, filters.limit);
        }

        return responses;
    }

    clear(): void {
        this.apps.clear();
        this.neurons.clear();
        this.collaterals.clear();
        this.dendrites.clear();
        this.stimulations.clear();
        this.responses.clear();
        this.neuronsByCns.clear();
        this.collateralsByCns.clear();
        this.dendritesByCns.clear();
        this.stimulationsByApp.clear();
        this.responsesByCns.clear();
        this.cnsByApp.clear();
    }

    // CNS management
    private cnsByApp = new Map<string, Set<string>>();

    async addCnsToApp(appId: string, cnsId: string): Promise<void> {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        set.add(cnsId);
        this.cnsByApp.set(appId, set);
    }

    async removeCnsFromApp(appId: string, cnsId: string): Promise<void> {
        const set = this.cnsByApp.get(appId);
        if (set) {
            set.delete(cnsId);
            if (set.size === 0) {
                this.cnsByApp.delete(appId);
            } else {
                this.cnsByApp.set(appId, set);
            }
        }
    }

    async getCnsByApp(appId: string): Promise<string[]> {
        const set = this.cnsByApp.get(appId) || new Set<string>();
        return Array.from(set);
    }

    async findAppIdByCnsId(cnsId: string): Promise<string | undefined> {
        for (const [appId, set] of this.cnsByApp.entries()) {
            if (set.has(cnsId)) return appId;
        }
        return undefined;
    }

    // Replay management
    async getReplaysByApp(
        appId: string,
        filters?: {
            fromTimestamp?: number;
            toTimestamp?: number;
            limit?: number;
            offset?: number;
        }
    ): Promise<Array<{ timestamp: number }>> {
        // For now, return empty array as replays are not implemented yet
        // This is a placeholder implementation
        return [];
    }
}
