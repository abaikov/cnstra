export type TCNSDevToolsTransportHooks = {
    onOpen(): void;
    onClose(info: { code: number; reason?: string; willRetry: boolean }): void;
    onError(info: { message: string }): void;
    onMessage(data: string): void;
};
