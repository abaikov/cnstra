export interface ICNSEventEngine {
    start(): void;
    stop(): void;
    setGraphData(nodes: unknown[], edges: unknown[]): void;
}
