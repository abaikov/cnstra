import { CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID } from '@cnstra/devtools-dto';
import { CNSDevToolsPageConfig } from '../CNSDevToolsPageConfig';

const serveConfig = (text: string): HTMLScriptElement => {
    const element = document.createElement('script');
    element.type = 'application/json';
    element.id = CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID;
    element.textContent = text;
    document.head.appendChild(element);
    return element;
};

describe('the page config the devtools handler serves', () => {
    afterEach(() => {
        document.getElementById(CNS_DEVTOOLS_PANEL_CONFIG_ELEMENT_ID)?.remove();
        window.history.replaceState({}, '', '/');
    });

    it('reads the base path, the transport and read-only from the served config, on the page origin', () => {
        serveConfig(JSON.stringify({ basePath: '/admin/devtools/', transport: 'polling', readOnly: true }));

        expect(CNSDevToolsPageConfig.read()).toEqual({
            httpUrl: `${window.location.origin}/admin/devtools`,
            socketUrl: `${window.location.origin.replace(/^http/, 'ws')}/admin/devtools`,
            transportKind: 'polling',
            isReadOnly: true,
            location: 'hash',
        });
    });

    it('resolves a mount url against the page location and defaults to polling, not read-only, in memory', () => {
        window.history.replaceState({}, '', '/admin/');

        expect(CNSDevToolsPageConfig.fromMountOptions({ url: 'cnstra/' })).toEqual({
            httpUrl: `${window.location.origin}/admin/cnstra`,
            socketUrl: `${window.location.origin.replace(/^http/, 'ws')}/admin/cnstra`,
            transportKind: 'polling',
            isReadOnly: false,
            location: 'memory',
        });
        expect(CNSDevToolsPageConfig.fromMountOptions({ url: 'https://admin.example.com/cnstra', transport: 'socket', isReadOnly: true, location: 'hash' })).toEqual({
            httpUrl: 'https://admin.example.com/cnstra',
            socketUrl: 'wss://admin.example.com/cnstra',
            transportKind: 'socket',
            isReadOnly: true,
            location: 'hash',
        });
    });

    it('ignores a served config that is not valid and falls back to the standalone address and ?transport=', () => {
        serveConfig('{"basePath": 1}');
        window.history.replaceState({}, '', '/?transport=polling');

        expect(CNSDevToolsPageConfig.read()).toEqual({
            httpUrl: 'http://localhost:8080',
            socketUrl: 'ws://localhost:8080',
            transportKind: 'polling',
            isReadOnly: false,
            location: 'hash',
        });
    });
});
