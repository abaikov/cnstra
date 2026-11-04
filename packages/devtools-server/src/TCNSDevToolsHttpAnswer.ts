export type TCNSDevToolsHttpAnswer = {
    status: number;
    headers: Record<string, string>;
    body: string | Uint8Array<ArrayBuffer>;
};
