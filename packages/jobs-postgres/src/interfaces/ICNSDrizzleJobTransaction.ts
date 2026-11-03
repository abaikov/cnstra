export interface ICNSDrizzleJobTransaction<TChunk = unknown> {
    execute(query: TChunk): PromiseLike<unknown>;
}
