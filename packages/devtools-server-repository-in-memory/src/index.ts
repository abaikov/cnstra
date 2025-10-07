import { DevToolsApp } from '@cnstra/devtools-dto';
import { ICNSDevToolsServerRepository } from '@cnstra/devtools-server';

export class CNSDevToolsServerRepositoryInMemory
    implements ICNSDevToolsServerRepository
{
    private apps = new Map<string, DevToolsApp>();
    private messages: any[] = [];

    upsertApp(app: DevToolsApp): void {
        const now = Date.now();

        // Create a new app object with proper timestamps
        const updatedApp: DevToolsApp = {
            appId: app.appId,
            appName: app.appName,
            version: app.version,
            lastSeenAt: now,
            firstSeenAt: this.apps.has(app.appId)
                ? this.apps.get(app.appId)!.firstSeenAt
                : now,
        };

        this.apps.set(app.appId, updatedApp);
    }

    listApps(): DevToolsApp[] {
        return Array.from(this.apps.values());
    }

    saveMessage(message: any): void {
        this.messages.push({
            ...message,
            receivedAt: Date.now(),
        });

        // Keep only last 1000 messages
        if (this.messages.length > 1000) {
            this.messages = this.messages.slice(-1000);
        }
    }

    getMessages(): any[] {
        return [...this.messages];
    }

    clear(): void {
        this.apps.clear();
        this.messages.length = 0;
    }
}
