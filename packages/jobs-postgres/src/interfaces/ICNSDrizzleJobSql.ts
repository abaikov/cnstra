export interface ICNSDrizzleJobSql<TChunk = unknown> {
    raw(text: string): TChunk;
    param(value: unknown): TChunk;
    join(chunks: TChunk[], separator?: TChunk): TChunk;
}
