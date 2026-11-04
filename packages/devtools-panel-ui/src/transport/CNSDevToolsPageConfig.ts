import { CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID, CNSDevToolsPanelConfigSchema } from '@cnstra/devtools-dto';
import type { TCNSDevToolsPageConfig } from '../types/TCNSDevToolsPageConfig';
import type { TCNSDevToolsPanelMountOptions } from '../types/TCNSDevToolsPanelMountOptions';
import type { TCNSDevToolsWindow } from '../types/TCNSDevToolsWindow';

const STANDALONE_SOCKET_URL = 'ws://localhost:8080';

export class CNSDevToolsPageConfig {
    public static read(): TCNSDevToolsPageConfig {
        const served = CNSDevToolsPageConfig.servedConfigOf(document.getElementById(CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID)?.textContent);
        if (served !== undefined) return CNSDevToolsPageConfig.fromMountOptions({ url: served.basePath, transport: served.transport, isReadOnly: served.readOnly, location: 'hash' });
        const devToolsWindow: TCNSDevToolsWindow = window;
        const socketUrl = (devToolsWindow.__CNSTRA_DEVTOOLS_WS__ || STANDALONE_SOCKET_URL).replace(/\/+$/, '');
        const requested = new URLSearchParams(window.location.search).get('transport');
        return {
            httpUrl: socketUrl.replace(/^ws/, 'http'),
            socketUrl,
            transportKind: requested === 'polling' || requested === 'demo' ? requested : 'socket',
            isReadOnly: false,
            location: 'hash',
        };
    }

    public static fromMountOptions(options: TCNSDevToolsPanelMountOptions): TCNSDevToolsPageConfig {
        const httpUrl = new URL(options.url, window.location.href).href.replace(/\/+$/, '');
        return {
            httpUrl,
            socketUrl: httpUrl.replace(/^http/, 'ws'),
            transportKind: options.transport ?? 'polling',
            isReadOnly: options.isReadOnly ?? false,
            location: options.location ?? 'memory',
            db: options.db,
        };
    }

    private static servedConfigOf(text: string | null | undefined) {
        if (text === null || text === undefined) return undefined;
        try {
            const parsed = CNSDevToolsPanelConfigSchema.safeParse(JSON.parse(text));
            return parsed.success ? parsed.data : undefined;
        } catch {
            return undefined;
        }
    }
}
