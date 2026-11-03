const unavailable = (name: string) => () => {
    throw new Error(`[devtools demo] ${name} is not available in the browser`);
};

export const createServer = unavailable('http.createServer');
export const existsSync = () => false;
export const readFileSync = unavailable('fs.readFileSync');
export const join = (...parts: string[]) => parts.join('/');
export const dirname = (path: string) => path.replace(/\/[^/]*$/, '');
export const createRequire = () => unavailable('module.createRequire');
export const randomUUID = () => globalThis.crypto.randomUUID();
export class WebSocketServer {
    constructor() {
        unavailable('ws.WebSocketServer')();
    }
}
export class WebSocket {}
export default {};
