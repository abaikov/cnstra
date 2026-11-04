export type TCNSDevToolsDemoSocket = {
    readonly readyState: number;
    send(data: string): void;
};
