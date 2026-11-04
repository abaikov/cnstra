import { existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, extname, join, sep } from 'path';
import type { TCNSDevToolsHttpAnswer } from './TCNSDevToolsHttpAnswer';
import type { TCNSDevToolsPanelConfig } from '@cnstra/devtools-dto';
import { CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID } from '@cnstra/devtools-dto';

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain; charset=utf-8',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';


export class CNSDevToolsPanelPage {

    private html: Promise<TCNSDevToolsHttpAnswer> | undefined;
    private readonly files = new Map<string, TCNSDevToolsHttpAnswer>();

    constructor(
        private readonly directory: string | undefined,
        private readonly config: TCNSDevToolsPanelConfig
    ) {}

    public static locate(): string | undefined {
        const fromWorkingDirectory = createRequire(join(process.cwd(), 'package.json'));
        const candidates: Array<() => string> = [
            () => join(dirname(fromWorkingDirectory.resolve('@cnstra/devtools-panel-ui/package.json')), 'dist'),
            () => join(dirname(fromWorkingDirectory.resolve('@cnstra/devtools-server/package.json')), '..', 'devtools-panel-ui', 'dist'),
        ];
        for (const candidate of candidates) {
            try {
                const directory = candidate();
                if (existsSync(join(directory, 'index.html'))) return directory;
            } catch {}
        }
        return undefined;
    }

    public page(): Promise<TCNSDevToolsHttpAnswer> {
        this.html ??= this.render();
        return this.html;
    }


    public async file(relativePath: string): Promise<TCNSDevToolsHttpAnswer | undefined> {
        if (relativePath === '/index.html') return this.page();
        const known = this.files.get(relativePath);
        if (known) return known;
        const answer = await this.read(relativePath);
        if (answer?.status === 200) this.files.set(relativePath, answer);
        return answer;
    }

    private async render(): Promise<TCNSDevToolsHttpAnswer> {
        if (!this.directory) {
            return {
                status: 503,
                headers: { 'content-type': CONTENT_TYPES['.txt'] },
                body: 'The CNStra DevTools panel is not installed. Install @cnstra/devtools-panel-ui.',
            };
        }
        const built = await readFile(join(this.directory, 'index.html'), 'utf8');
        const prefix = this.config.basePath === '/' ? '/' : `${this.config.basePath}/`;
        const rewritten = built.replace(/(\s(?:src|href)=["'])\.\//g, `$1${prefix}`);
        const configElement =
            `<script type="application/json" id="${CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID}">` +
            `${JSON.stringify(this.config).replace(/</g, '\\u003c')}</script>`;
        const firstScript = rewritten.indexOf('<script');
        const insertAt = firstScript >= 0 ? firstScript : rewritten.indexOf('</head>');
        const body =
            insertAt >= 0
                ? `${rewritten.slice(0, insertAt)}${configElement}${rewritten.slice(insertAt)}`
                : `${configElement}${rewritten}`;
        return {
            status: 200,
            headers: { 'content-type': CONTENT_TYPES['.html'], 'cache-control': REVALIDATE },
            body,
        };
    }

    private async read(relativePath: string): Promise<TCNSDevToolsHttpAnswer | undefined> {
        if (!this.directory) return undefined;
        let segments: string[];
        try {
            segments = relativePath.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
        } catch {
            return CNSDevToolsPanelPage.refused();
        }
        if (segments.some(segment => segment === '..' || segment === '.' || /[\\/\0]/.test(segment))) {
            return CNSDevToolsPanelPage.refused();
        }
        const full = join(this.directory, ...segments);
        if (!full.startsWith(this.directory + sep)) return CNSDevToolsPanelPage.refused();
        try {
            if (!(await stat(full)).isFile()) return undefined;
        } catch {
            return undefined;
        }
        return {
            status: 200,
            headers: {
                'content-type': CONTENT_TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream',
                'cache-control': segments[0] === 'assets' ? IMMUTABLE : REVALIDATE,
            },
            body: new Uint8Array(await readFile(full)),
        };
    }

    private static refused(): TCNSDevToolsHttpAnswer {
        return { status: 403, headers: { 'content-type': CONTENT_TYPES['.txt'] }, body: 'Forbidden' };
    }
}
