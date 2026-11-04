export interface ICNSDevToolsTransport {
    send(data: string): boolean;
    dispose(): void;
}
