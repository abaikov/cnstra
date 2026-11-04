import type { TCNSDevToolsTransportHooks } from '../../types/TCNSDevToolsTransportHooks';

export class CNSRecordingTransportHooks implements TCNSDevToolsTransportHooks {
    public opens = 0;
    public readonly closes: Array<{ code: number; reason?: string; willRetry: boolean }> = [];
    public readonly errors: string[] = [];
    public readonly messages: string[] = [];

    public onOpen(): void {
        this.opens++;
    }

    public onClose(info: { code: number; reason?: string; willRetry: boolean }): void {
        this.closes.push(info);
    }

    public onError(info: { message: string }): void {
        this.errors.push(info.message);
    }

    public onMessage(data: string): void {
        this.messages.push(data);
    }
}
