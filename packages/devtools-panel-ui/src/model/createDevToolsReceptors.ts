import { CNSHomeostatBatchTransducer, CNSHomeostatReceptor } from '@cnstra/sync';
import type { TCNSHomeostatBatchTransducerOptions } from '@cnstra/sync';
import type { TCNSDevToolsSyncData, TCNSDevToolsSyncKeys, TCNSDevToolsSyncReceptorName } from '@cnstra/devtools-dto';
import type { TCNSDevToolsReceptors } from './types/TCNSDevToolsReceptors';
import { HOMEOSTAT_REFRACTORY_POLICY } from './constants/HOMEOSTAT_REFRACTORY_POLICY';
import { LIVE_STALE_TIME_MS } from './constants/LIVE_STALE_TIME_MS';
import { SLOW_STALE_TIME_MS } from './constants/SLOW_STALE_TIME_MS';

export function createDevToolsReceptors(batchTransduceFn: TCNSHomeostatBatchTransducerOptions['batchTransduceFn']): TCNSDevToolsReceptors {
    const homeostatBatchTransducer = new CNSHomeostatBatchTransducer({ batchTransduceFn });
    const receptorOf = <TName extends TCNSDevToolsSyncReceptorName>(name: TName, staleTimeMs: number) =>
        new CNSHomeostatReceptor<TCNSDevToolsSyncKeys[TName], TCNSDevToolsSyncData[TName]>({
            name,
            staleTimeMs,
            homeostatRefractoryPolicy: HOMEOSTAT_REFRACTORY_POLICY,
            transduce: homeostatBatchTransducer.transduceOf<TCNSDevToolsSyncKeys[TName], TCNSDevToolsSyncData[TName]>(
                name,
                ([data]) => data as TCNSDevToolsSyncData[TName]
            ),
        });
    return {
        apps: receptorOf('apps', SLOW_STALE_TIME_MS),
        topology: receptorOf('topology', SLOW_STALE_TIME_MS),
        stimulationPage: receptorOf('stimulationPage', LIVE_STALE_TIME_MS),
        stimulationFacets: receptorOf('stimulationFacets', LIVE_STALE_TIME_MS),
        stimulationSnapshot: receptorOf('stimulationSnapshot', LIVE_STALE_TIME_MS),
        stimulationDetail: receptorOf('stimulationDetail', LIVE_STALE_TIME_MS),
        scheduledPage: receptorOf('scheduledPage', LIVE_STALE_TIME_MS),
    };
}
