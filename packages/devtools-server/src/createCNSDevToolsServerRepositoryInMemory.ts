import type { ICNSDevToolsServerRepository } from './index';

// A non-literal specifier: the in-memory package imports this package's types, so tsc must not resolve it here.
const CNS_DEVTOOLS_SERVER_REPOSITORY_IN_MEMORY_MODULE = '@cnstra/devtools-server-repository-in-memory';

export async function createCNSDevToolsServerRepositoryInMemory(): Promise<ICNSDevToolsServerRepository> {
    const { CNSDevToolsServerRepositoryInMemory }: { CNSDevToolsServerRepositoryInMemory: new () => ICNSDevToolsServerRepository } =
        await import(CNS_DEVTOOLS_SERVER_REPOSITORY_IN_MEMORY_MODULE);
    return new CNSDevToolsServerRepositoryInMemory();
}
