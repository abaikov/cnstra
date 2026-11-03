export interface ICNSKyselyJobTransaction {
    withoutPlugins(): {
        executeQuery(query: {
            query: { kind: 'RawNode'; sqlFragments: readonly string[]; parameters: readonly never[] };
            sql: string;
            parameters: readonly unknown[];
            queryId: { queryId: string };
        }): Promise<{ rows: unknown[] }>;
    };
}
