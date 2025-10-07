import {
    DevToolsApp,
    InitMessage,
    NeuronResponseMessage,
    ResponseBatchMessage,
    AppsActiveMessage,
    AppDisconnectedMessage,
    StimulateCommand,
    StimulateAccepted,
    StimulateRejected,
    StimulationMessage,
    StimulationBatchMessage,
} from '@cnstra/devtools-dto';
import { WebSocket } from 'ws';

export interface ICNSDevToolsServerRepository {
    upsertApp(app: DevToolsApp): Promise<void> | void;
    listApps(): Promise<DevToolsApp[]> | DevToolsApp[];
    saveMessage(message: any): Promise<void> | void;
}

export class CNSDevToolsServer {
    private appSockets = new Map<string, WebSocket>();
    private clientSockets = new Set<WebSocket>();
    private lastInitByApp = new Map<string, InitMessage>();
    private stimulationsByApp = new Map<string, StimulationMessage[]>();
    private stimulationBuffer: StimulationMessage[] = [];
    // Topology per CNS (cnsId == devToolsInstanceId for now)
    private neuronsByCns = new Map<string, any[]>();
    private dendritesByCns = new Map<string, any[]>();
    private collateralsByCns = new Map<string, any[]>();
    private responsesByCns = new Map<string, any[]>();
    private cnsByApp = new Map<string, Set<string>>();

    constructor(private repository: ICNSDevToolsServerRepository) {}

    private isNeuronResponseMessage(message: any): boolean {
        return (
            message &&
            typeof message.stimulationId === 'string' &&
            typeof message.neuronId === 'string' &&
            typeof message.appId === 'string' &&
            typeof message.collateralName === 'string' &&
            typeof message.timestamp === 'number' &&
            !message.type
        ); // No type field indicates raw NeuronResponseMessage
    }

    // Expose sockets map size for tests
    /** @internal */
    get connectedAppCount(): number {
        return this.appSockets.size;
    }

    async handleMessage(ws: WebSocket, message: any): Promise<any> {
        console.log(
            '🔧 Server received message:',
            JSON.stringify(message, null, 2)
        );
        switch (message.type) {
            case 'init':
                return this.handleInit(ws, message as InitMessage);

            case 'neuron-response-batch':
            case 'response-batch':
                return this.handleResponseBatch(
                    ws,
                    message as ResponseBatchMessage
                );

            case 'stimulate':
                return this.handleStimulate(ws, message as StimulateCommand);

            case 'stimulate-accepted':
                await this.repository.saveMessage(message);
                // Forward ack to clients
                return message as StimulateAccepted;

            case 'stimulate-rejected':
                await this.repository.saveMessage(message);
                // Forward nack to clients
                return message as StimulateRejected;

            case 'stimulation':
                return this.handleStimulation(
                    ws,
                    message as StimulationMessage
                );

            case 'apps:get-topology': {
                const inits = Array.from(this.lastInitByApp.values());
                return { type: 'apps:topology', inits } as any;
            }

            case 'apps:get-stimulations': {
                const { appId, limit } = message as any;
                let stimulations: StimulationMessage[] = [];
                if (appId) {
                    stimulations = this.stimulationsByApp.get(appId) || [];
                } else {
                    // Merge all apps' stimulations when appId is not provided
                    for (const arr of this.stimulationsByApp.values()) {
                        stimulations = stimulations.concat(arr);
                    }
                    // Sort by timestamp ASC to maintain original order
                    stimulations.sort((a, b) => a.timestamp - b.timestamp);
                }
                // Optional limit (take last N)
                const out =
                    typeof limit === 'number' && limit > 0
                        ? stimulations.slice(
                              Math.max(0, stimulations.length - limit)
                          )
                        : stimulations;
                return {
                    type: 'stimulation-batch',
                    stimulations: out,
                } as StimulationBatchMessage;
            }

            // REST-like over WS
            case 'apps:list': {
                const apps = await this.repository.listApps();
                return { type: 'apps:list', apps };
            }
            case 'apps:get-cns': {
                const { appId } = message as any;
                const set = this.cnsByApp.get(appId) || new Set<string>();
                const cns = Array.from(set).map(cnsId => ({ cnsId, appId }));
                return { type: 'apps:cns', appId, cns };
            }
            case 'cns:get-neurons': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:neurons',
                    cnsId,
                    neurons: this.neuronsByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-dendrites': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:dendrites',
                    cnsId,
                    dendrites: this.dendritesByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-collaterals': {
                const { cnsId } = message as any;
                return {
                    type: 'cns:collaterals',
                    cnsId,
                    collaterals: this.collateralsByCns.get(cnsId) || [],
                };
            }
            case 'cns:get-responses': {
                const { cnsId, limit } = message as any;
                let responses = this.responsesByCns.get(cnsId) || [];
                if (typeof limit === 'number' && limit > 0) {
                    responses = responses.slice(
                        Math.max(0, responses.length - limit)
                    );
                }
                return { type: 'cns:responses', cnsId, responses };
            }

            default:
                // Handle NeuronResponseMessage without type field (from devtools transport)
                if (this.isNeuronResponseMessage(message)) {
                    const stimulationMessage: StimulationMessage = {
                        type: 'stimulation',
                        appId: message.appId,
                        stimulationId: message.stimulationId,
                        timestamp: message.timestamp,
                        neuronId: message.neuronId,
                        collateralName: message.collateralName,
                        payload: message.payload,
                        queueLength: 0, // TODO: Get actual queue length
                        error: message.error,
                    };
                    return this.handleStimulation(ws, stimulationMessage);
                }
                console.log('Unknown message type:', message.type);
                return null;
        }
    }

    async handleInit(
        ws: WebSocket,
        message: InitMessage
    ): Promise<AppsActiveMessage> {
        // Prefer new clean fields from InitMessage
        const baseAppId =
            (message as any).appId || (message as any).devToolsInstanceId;
        const cnsId =
            (message as any).cnsId || (message as any).devToolsInstanceId;

        this.lastInitByApp.set(cnsId, message as any);
        const app: DevToolsApp = {
            appId: baseAppId as any,
            appName: message.appName,
            version: message.version,
            firstSeenAt: Date.now(),
            lastSeenAt: Date.now(),
        };

        console.log('🔧 Creating app object:', JSON.stringify(app, null, 2));
        await this.repository.upsertApp(app);
        await this.repository.saveMessage(message);

        this.appSockets.set(cnsId as any, ws);

        // Store topology per CNS (use derived cnsId from legacy id)
        this.neuronsByCns.set(cnsId as any, (message as any).neurons || []);
        this.collateralsByCns.set(
            cnsId as any,
            (message as any).collaterals || []
        );
        this.dendritesByCns.set(cnsId as any, (message as any).dendrites || []);
        const set = this.cnsByApp.get(app.appId) || new Set<string>();
        set.add(cnsId as any);
        this.cnsByApp.set(app.appId, set);

        console.log(
            `✅ App connected: ${message.appName} (${message.devToolsInstanceId})`
        );
        console.log(
            `📊 Topology: ${message.neurons.length} neurons, ${message.collaterals.length} collaterals, ${message.dendrites.length} dendrites`
        );

        // Return apps list to broadcast
        const apps = await this.repository.listApps();
        console.log('📋 Server returning apps:', JSON.stringify(apps, null, 2));
        return {
            type: 'apps:active',
            apps: apps,
        };
    }

    async handleResponseBatch(
        ws: WebSocket,
        message: ResponseBatchMessage
    ): Promise<ResponseBatchMessage> {
        await this.repository.saveMessage(message);
        console.log(`📦 Response batch: ${message.responses.length} responses`);

        // Persist responses per cnsId (instanceId)
        const cnsId =
            (message as any).instanceId || (message as any).devToolsInstanceId;
        if (cnsId) {
            const list = this.responsesByCns.get(cnsId) || [];
            list.push(...(message.responses || []));
            // Keep last N
            if (list.length > 2000) list.splice(0, list.length - 2000);
            this.responsesByCns.set(cnsId, list);
        }

        // Forward to clients
        return message;
    }

    async handleStimulate(
        ws: WebSocket,
        message: StimulateCommand
    ): Promise<null> {
        await this.repository.saveMessage(message);
        console.log(`🎯 Stimulate command received`);

        // Determine routing target: prefer cnsId, else appId, else broadcast
        const cnsIdFromCmd = (message as any).cnsId as string | undefined;
        const appIdFromCmd = (message as any).appId as string | undefined;

        try {
            if (cnsIdFromCmd) {
                const appWs = this.appSockets.get(cnsIdFromCmd);
                if (appWs && appWs.readyState === 1) {
                    appWs.send(JSON.stringify(message));
                    console.log(
                        `📨 Stimulate forwarded to cns ${cnsIdFromCmd}`
                    );
                } else {
                    console.warn(
                        `⚠️ CNS socket not available for ${cnsIdFromCmd}`
                    );
                }
            } else if (appIdFromCmd) {
                const cnsSet = this.cnsByApp.get(appIdFromCmd);
                let count = 0;
                if (cnsSet) {
                    for (const cnsId of cnsSet.values()) {
                        const appWs = this.appSockets.get(cnsId);
                        if (appWs && appWs.readyState === 1) {
                            appWs.send(JSON.stringify(message));
                            count++;
                        }
                    }
                }
                console.log(
                    `📨 Stimulate forwarded to ${count} CNS of app ${appIdFromCmd}`
                );
            } else {
                // Fallback: broadcast to all app sockets
                let count = 0;
                for (const [, appWs] of this.appSockets.entries()) {
                    if (appWs.readyState === 1) {
                        appWs.send(JSON.stringify(message));
                        count++;
                    }
                }
                console.log(`📨 Stimulate broadcast to ${count} app(s)`);
            }
        } catch (e) {
            console.error('❌ Failed to forward stimulate:', e);
        }

        return null;
    }

    private findAppIdByCnsId(cnsId?: string): string | undefined {
        if (!cnsId) return undefined;
        for (const [appId, set] of this.cnsByApp.entries()) {
            if (set.has(cnsId)) return appId;
        }
        return undefined;
    }

    handleDisconnect(ws: WebSocket): void {
        // Remove from app sockets
        for (const [cnsId, socket] of this.appSockets.entries()) {
            if (socket === ws) {
                this.appSockets.delete(cnsId);
                console.log(`❌ CNS disconnected: ${cnsId}`);

                // Derive base appId from cnsId
                const sepIdx = cnsId.indexOf(':');
                const baseAppId = sepIdx > 0 ? cnsId.slice(0, sepIdx) : cnsId;

                // Remove per-CNS cached topology
                this.neuronsByCns.delete(cnsId);
                this.dendritesByCns.delete(cnsId);
                this.collateralsByCns.delete(cnsId);
                this.responsesByCns.delete(cnsId);
                this.lastInitByApp.delete(cnsId);

                // Update cnsByApp mapping
                const cnsSet = this.cnsByApp.get(baseAppId);
                if (cnsSet) {
                    cnsSet.delete(cnsId);
                    if (cnsSet.size === 0) {
                        this.cnsByApp.delete(baseAppId);
                        this.stimulationsByApp.delete(baseAppId);
                    } else {
                        this.cnsByApp.set(baseAppId, cnsSet);
                    }
                }
                break;
            }
        }

        // Remove from client sockets
        this.clientSockets.delete(ws);
    }

    addClient(ws: WebSocket): void {
        this.clientSockets.add(ws);
    }

    async handleStimulation(
        ws: WebSocket,
        message: StimulationMessage
    ): Promise<void> {
        console.log('🧠 Server received stimulation:', {
            appId: message.appId,
            neuronId: message.neuronId,
            collateralName: message.collateralName,
            timestamp: message.timestamp,
        });

        // Store stimulation for the app
        const appStimulations = this.stimulationsByApp.get(message.appId) || [];
        appStimulations.push(message);

        // Keep only last 1000 stimulations per app to prevent memory issues
        if (appStimulations.length > 1000) {
            appStimulations.splice(0, appStimulations.length - 1000);
        }

        this.stimulationsByApp.set(message.appId, appStimulations);

        // Add to buffer for batch sending
        this.stimulationBuffer.push(message);

        // Send immediately to all connected devtools clients
        this.broadcastToClients({
            type: 'stimulation-batch',
            stimulations: [message],
        } as StimulationBatchMessage);

        // Save to repository
        await this.repository.saveMessage(message);
    }

    private broadcastToClients(message: any): void {
        const messageStr = JSON.stringify(message);
        this.clientSockets.forEach(clientWs => {
            if (clientWs.readyState === 1) {
                // WebSocket.OPEN
                clientWs.send(messageStr);
            }
        });
    }

    async getActiveApps(): Promise<DevToolsApp[]> {
        return await this.repository.listApps();
    }
}
