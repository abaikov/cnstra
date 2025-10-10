import { DevToolsApp } from '@cnstra/devtools-dto';
import { ICNSDevToolsServerRepository } from '@cnstra/devtools-server';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface FileRepositoryOptions {
    baseDir: string;
    appsFile?: string; // defaults to apps.json
    messagesFile?: string; // defaults to messages.jsonl
    maxMessages?: number; // keep last N messages
}

export class CNSDevToolsServerRepositoryFile
    implements ICNSDevToolsServerRepository
{
    private readonly appsPath: string;
    private readonly messagesPath: string;
    private apps = new Map<
        string,
        DevToolsApp & {
            version?: string;
            firstSeenAt?: number;
            lastSeenAt?: number;
        }
    >();
    private isInitialized = false;
    private readonly maxMessages: number;

    constructor(private readonly options: FileRepositoryOptions) {
        this.appsPath = path.join(
            options.baseDir,
            options.appsFile ?? 'apps.json'
        );
        this.messagesPath = path.join(
            options.baseDir,
            options.messagesFile ?? 'messages.jsonl'
        );
        this.maxMessages = options.maxMessages ?? 5000;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) return;
        await fs.mkdir(this.options.baseDir, { recursive: true });
        // Load apps
        try {
            const content = await fs.readFile(this.appsPath, 'utf8');
            const arr: DevToolsApp[] = JSON.parse(content);
            for (const app of arr) {
                this.apps.set(app.appId, app);
            }
        } catch {
            await fs.writeFile(this.appsPath, '[]', 'utf8');
        }
        // Ensure messages file exists
        try {
            await fs.access(this.messagesPath);
        } catch {
            await fs.writeFile(this.messagesPath, '', 'utf8');
        }
        this.isInitialized = true;
    }

    async upsertApp(app: DevToolsApp): Promise<void> {
        await this.ensureInitialized();
        const now = Date.now();
        const existing = this.apps.get(app.appId);
        const updated = {
            appId: app.appId,
            appName: app.appName,
            version: (app as any).version as string | undefined,
            firstSeenAt:
                existing?.firstSeenAt ?? (app as any).firstSeenAt ?? now,
            lastSeenAt: now,
        };
        this.apps.set(app.appId, updated);
        await fs.writeFile(
            this.appsPath,
            JSON.stringify(Array.from(this.apps.values()), null, 2),
            'utf8'
        );
    }

    async listApps(): Promise<DevToolsApp[]> {
        await this.ensureInitialized();
        return Array.from(this.apps.values()) as unknown as DevToolsApp[];
    }

    async saveMessage(message: any): Promise<void> {
        await this.ensureInitialized();
        // Append JSON line
        const line = JSON.stringify({ ...message, receivedAt: Date.now() });
        await fs.appendFile(this.messagesPath, line + '\n', 'utf8');
        // Trim to last N lines if file is too big (simple approach)
        try {
            const buf = await fs.readFile(this.messagesPath, 'utf8');
            const lines = buf.split('\n').filter(Boolean);
            if (lines.length > this.maxMessages) {
                const trimmed = lines.slice(lines.length - this.maxMessages);
                await fs.writeFile(
                    this.messagesPath,
                    trimmed.join('\n') + '\n',
                    'utf8'
                );
            }
        } catch {
            // ignore
        }
    }
}
