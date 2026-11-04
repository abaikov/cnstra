import { CNSDevToolsLocalRequestPolicy } from '../src/CNSDevToolsLocalRequestPolicy';

const upgradeRequest = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers });

describe('CNSDevToolsLocalRequestPolicy', () => {
    it('lets a loopback client without an Origin and the page of this server upgrade, and refuses other pages', () => {
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'localhost:3141' }), 3141)).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'localhost:3141', origin: 'http://localhost:3141' }), 3141)).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'localhost:3141', origin: 'https://evil.example' }), 3141)).toBe(false);
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'evil.example:3141', origin: 'http://evil.example:3141' }), 3141)).toBe(false);
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('192.168.1.7', { host: 'localhost:3141' }), 3141)).toBe(false);
    });

    it('lets an explicitly trusted origin upgrade, and nothing else on its strength', () => {
        const trusted = ['http://localhost:5173'];
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'localhost:3141', origin: 'http://localhost:5173' }), 3141, trusted)).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isLocalUpgrade(upgradeRequest('127.0.0.1', { host: 'localhost:3141', origin: 'null' }), 3141, trusted)).toBe(false);
        expect(CNSDevToolsLocalRequestPolicy.isSameOriginUpgrade(upgradeRequest('10.0.0.2', { host: '10.0.0.1:3141', origin: 'http://10.0.0.1:3141' }))).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isSameOriginUpgrade(upgradeRequest('10.0.0.2', { host: '10.0.0.1:3141', origin: 'http://evil.example' }), trusted)).toBe(false);
    });

    it('knows a loopback bind and a loopback Host on the right port', () => {
        expect(CNSDevToolsLocalRequestPolicy.isLoopbackBind('127.0.0.1')).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isLoopbackBind('0.0.0.0')).toBe(false);
        expect(CNSDevToolsLocalRequestPolicy.isLoopbackHost('[::1]:3141', 3141)).toBe(true);
        expect(CNSDevToolsLocalRequestPolicy.isLoopbackHost('localhost:3142', 3141)).toBe(false);
        expect(CNSDevToolsLocalRequestPolicy.isLoopbackHost(undefined, 3141)).toBe(false);
    });
});
