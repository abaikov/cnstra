export interface ICNSExplorerAddress {
    read(): string;
    readTracked(): string;
    write(hash: string): void;
}
