export type TCNSHomeostatTransductionRow =
    | { readonly name: string; readonly key: readonly unknown[]; readonly data: unknown }
    | { readonly name: string; readonly key: readonly unknown[]; readonly error: unknown }
    | { readonly name: string; readonly key: readonly unknown[] };
