import { CNSHomeostatTransductionQueryCodec } from '@cnstra/sync';
import type { TCNSHomeostatTransductionRequest, TCNSHomeostatTransductionRow } from '@cnstra/sync';
import type { TCNSDevToolsSyncData, TCNSDevToolsSyncKeys, TCNSDevToolsSyncReceptorName } from '@cnstra/devtools-dto';
import type { CNSDevToolsServer } from '../src/index';

const codec = CNSHomeostatTransductionQueryCodec.INSTANCE;

export async function transduceSync(
    server: CNSDevToolsServer,
    requests: readonly TCNSHomeostatTransductionRequest[]
): Promise<TCNSHomeostatTransductionRow[]> {
    const query = codec.encodeRequests(requests);
    const answer = await server.homeostatTransductionEndpoint.respond(query, codec.mediaType);
    if (answer.status !== 200) throw new Error(`sync answered ${answer.status}: ${answer.body}`);
    return codec.decodeRows(answer.body, query);
}

export async function readSync<TName extends TCNSDevToolsSyncReceptorName>(
    server: CNSDevToolsServer,
    name: TName,
    key: TCNSDevToolsSyncKeys[TName]
): Promise<TCNSDevToolsSyncData[TName]> {
    const [row] = await transduceSync(server, [{ name, key }]);
    if (!('data' in row)) throw new Error(`${name} answered without data: ${JSON.stringify(row)}`);
    return row.data as TCNSDevToolsSyncData[TName];
}

export const ANY_STIMULATION = [undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;
