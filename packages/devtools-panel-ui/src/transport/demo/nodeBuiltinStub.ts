const unavailable = (name: string) => () => {
    throw new Error(`[devtools demo] ${name} is not available in the browser`);
};

export const createServer = unavailable('http.createServer');
export const existsSync = () => false;
export const readFile = unavailable('fs.readFile');
export const stat = unavailable('fs.stat');
export const join = (...parts: string[]) => parts.join('/');
export const dirname = (path: string) => path.replace(/\/[^/]*$/, '');
export const extname = (path: string) => /\.[^./]*$/.exec(path)?.[0] ?? '';
export const sep = '/';
export const createRequire = () => unavailable('module.createRequire');
export const exec = unavailable('child_process.exec');
export const randomUUID = () => globalThis.crypto.randomUUID();
export class WebSocketServer {
    constructor() {
        unavailable('ws.WebSocketServer')();
    }
}
