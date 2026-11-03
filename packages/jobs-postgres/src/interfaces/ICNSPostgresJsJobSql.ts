import type { TCNSPostgresJobParameter } from '../types/TCNSPostgresJobParameter';

export interface ICNSPostgresJsJobSql {
    unsafe(query: string, parameters?: TCNSPostgresJobParameter[]): PromiseLike<ArrayLike<unknown> & { count?: number | null }>;
    begin<TResult>(work: (sql: ICNSPostgresJsJobSql) => Promise<TResult>): PromiseLike<unknown>;
    reserve(): PromiseLike<ICNSPostgresJsJobSql & { release(): void }>;
    listen(channel: string, onNotify: (value: string) => void): PromiseLike<{ unlisten(): PromiseLike<void> }>;
}
