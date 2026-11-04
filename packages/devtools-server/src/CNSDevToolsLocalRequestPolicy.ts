import type { IncomingHttpHeaders } from 'http';

type TCNSDevToolsUpgradeRequest = { readonly headers: IncomingHttpHeaders; readonly socket: { readonly remoteAddress?: string } };

export class CNSDevToolsLocalRequestPolicy {
    private static readonly LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

    private static readonly LOOPBACK_HOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

    public static isLoopbackBind(host: string): boolean {
        return CNSDevToolsLocalRequestPolicy.LOOPBACK_ADDRESSES.has(host) || host === 'localhost';
    }

    public static isLoopbackHost(host: string | undefined, port: number): boolean {
        if (!host) return false;
        try {
            const parsed = new URL(`http://${host}`);
            return CNSDevToolsLocalRequestPolicy.LOOPBACK_HOST_NAMES.has(parsed.hostname) && parsed.port === String(port);
        } catch {
            return false;
        }
    }

    public static isSameOriginUpgrade(request: TCNSDevToolsUpgradeRequest, trustedOrigins: readonly string[] = []): boolean {
        const { origin, host } = request.headers;
        if (origin === undefined) return true;
        if (trustedOrigins.includes(origin)) return true;
        return !!host && (origin === `http://${host}` || origin === `https://${host}`);
    }

    public static isLocalUpgrade(request: TCNSDevToolsUpgradeRequest, port: number, trustedOrigins: readonly string[] = []): boolean {
        if (!CNSDevToolsLocalRequestPolicy.LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? '')) return false;
        if (request.headers.origin !== undefined && !trustedOrigins.includes(request.headers.origin)
            && !CNSDevToolsLocalRequestPolicy.isLoopbackHost(request.headers.host, port)) return false;
        return CNSDevToolsLocalRequestPolicy.isSameOriginUpgrade(request, trustedOrigins);
    }
}
