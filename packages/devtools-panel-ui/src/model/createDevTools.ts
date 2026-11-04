import { OIMDB, OIMSlotAfterUnholdReleasePolicy } from '@oimdb/core';
import { createOIMBrowserVisibilitySingleSlotService } from '@oimdb/browser';
import { createCNSOIMDBHomeostatSchema } from '@cnstra/oimdb';
import type { TCNSDevToolsSyncData } from '@cnstra/devtools-dto';
import { CNSHomeostatStaleTimeRefetchPolicy } from '@cnstra/sync';
import { createDevToolsReceptors } from './createDevToolsReceptors';
import { createHeldEntitySingle } from './createHeldEntitySingle';
import { createCNSHashExplorerAddress } from './createCNSHashExplorerAddress';
import { defineStimulationModel } from './defineStimulationModel';
import { defineScheduledStimulationModel } from './defineScheduledStimulationModel';
import { defineTopologyModel } from './defineTopologyModel';
import { CNSStimulationDetailRefetchPolicy } from './CNSStimulationDetailRefetchPolicy';
import { CNSExplorerNavigation } from './CNSExplorerNavigation';
import { CNSStimulationDetails } from './CNSStimulationDetails';
import { KEEP_RECORD_AFTER_UNHOLD_MS } from './constants/KEEP_RECORD_AFTER_UNHOLD_MS';
import { IDLE_ACTION_FEEDBACK } from './constants/IDLE_ACTION_FEEDBACK';
import { createConnectionNeuron } from './neurons/createConnectionNeuron';
import { createListPagings } from './createListPagings';
import { createExplorerNavigationNeuron } from './neurons/createExplorerNavigationNeuron';
import { createListPagingNeuron } from './neurons/createListPagingNeuron';
import { createExplorerActionNeuron } from './neurons/createExplorerActionNeuron';
import { createActionFeedbackNeuron } from './neurons/createActionFeedbackNeuron';
import { createStimulationNeuron } from './neurons/createStimulationNeuron';
import { createScheduledStimulationNeuron } from './neurons/createScheduledStimulationNeuron';
import type { TCNSDevToolsConnection } from './types/TCNSDevToolsConnection';
import type { TCNSDevToolsOptions } from './types/TCNSDevToolsOptions';

export function createDevTools(options: TCNSDevToolsOptions) {
    const getNowMs = options.getNowMs ?? Date.now;
    const db = options.db ?? new OIMDB({ getNowMs });
    const onBrowserEntityWritten = () => db.flush();
    const visibilityService = createOIMBrowserVisibilitySingleSlotService({ onBrowserEntityWritten });
    const visibilitySlot = visibilityService.createStoreAggregate(visibilityService.createStoreSlot(db));
    const explorerAddress = (options.createExplorerAddress ?? createCNSHashExplorerAddress)(db);
    const initialConnection: TCNSDevToolsConnection = {
        status: 'connecting',
        isOnline: false,
        isReadOnly: options.isReadOnly ?? false,
        transportKind: options.transportKind,
        uiConfig: {},
    };
    const connection = createHeldEntitySingle(db, initialConnection);
    const actionFeedback = createHeldEntitySingle(db, IDLE_ACTION_FEEDBACK);
    const listPagings = createListPagings(db);
    const homeostatReceptors = createDevToolsReceptors(options.batchTransduceFn);
    const disposal = new AbortController();
    const homeostatModels = {
        stimulationModel: defineStimulationModel(homeostatReceptors),
        scheduledStimulationModel: defineScheduledStimulationModel(homeostatReceptors),
        topologyModel: defineTopologyModel(homeostatReceptors),
    };
    const schema = createCNSOIMDBHomeostatSchema(db, {
        homeostatModels,
        neuronFactories: {
            connectionNeuron: () => createConnectionNeuron({ connection, initialConnection }),
            explorerNavigationNeuron: () => createExplorerNavigationNeuron({ getNowMs, explorerAddress }),
            listPagingNeuron: () => createListPagingNeuron({ listPagings }),
            explorerActionNeuron: () => createExplorerActionNeuron({ actionClient: options.actionClient, connection }),
            actionFeedbackNeuron: () => createActionFeedbackNeuron({ actionFeedback, disposalSignal: disposal.signal }),
            stimulationNeuron: ({ stimulationModel, homeostatEnvironment }) => createStimulationNeuron({ stimulationModel, homeostatReceptors, homeostatEnvironment }),
            scheduledStimulationNeuron: ({ scheduledStimulationModel }) =>
                createScheduledStimulationNeuron({ scheduledStimulationModel }),
            topologyNeuron: ({ topologyModel }) => topologyModel.createNeuron(),
        },
        homeostatEnvironmentOptions: {
            onlineSlot: connection.getSingleSlot(),
            visibilitySlot: visibilitySlot.getSingleSlot(),
            homeostatCorrectionStoreSlotOptions: {
                slotReleasePolicy: new OIMSlotAfterUnholdReleasePolicy({ keepAfterUnholdMs: KEEP_RECORD_AFTER_UNHOLD_MS }),
            },
            createHomeostatRefetchPolicy: receptor => {
                const staleTimeRefetchPolicy = new CNSHomeostatStaleTimeRefetchPolicy({ staleTimeMs: receptor.staleTimeMs ?? Infinity, homeostatRefractoryPolicy: receptor.homeostatRefractoryPolicy });
                if (receptor.name !== homeostatReceptors.stimulationDetail.name) return staleTimeRefetchPolicy;
                return new CNSStimulationDetailRefetchPolicy({
                    staleTimeRefetchPolicy,
                    stimulationDetailOf: (stimulationId): TCNSDevToolsSyncData['stimulationDetail'] | undefined => CNSStimulationDetails.peek(schema.stimulationModel.summaries.stimulationDetail, stimulationId),
                });
            },
        },
    });
    const { stimulationModel, scheduledStimulationModel, topologyModel } = schema;

    return {
        db,
        cns: schema.cns,
        neurons: {
            ...schema.neurons,
            appsHomeostatReceptor: homeostatReceptors.apps.neuron,
            topologyHomeostatReceptor: homeostatReceptors.topology.neuron,
            stimulationPageHomeostatReceptor: homeostatReceptors.stimulationPage.neuron,
            stimulationFacetsHomeostatReceptor: homeostatReceptors.stimulationFacets.neuron,
            stimulationSnapshotHomeostatReceptor: homeostatReceptors.stimulationSnapshot.neuron,
            stimulationDetailHomeostatReceptor: homeostatReceptors.stimulationDetail.neuron,
            scheduledPageHomeostatReceptor: homeostatReceptors.scheduledPage.neuron,
            homeostatReceptorCorrection: schema.homeostatNeurons.homeostatReceptorCorrection,
        },
        models: {
            connection,
            actionFeedback,
            listPagings,
            stimulations: stimulationModel.collections.stimulations,
            stimulationPages: stimulationModel.buckets.stimulationPage.stimulations,
            stimulationPageCursors: stimulationModel.summaries.stimulationPage,
            stimulationSnapshots: stimulationModel.buckets.stimulationSnapshot.stimulations,
            stimulationFacets: stimulationModel.summaries.stimulationFacets,
            stimulationDetails: stimulationModel.summaries.stimulationDetail,
            stimulationPageHomeostasis: stimulationModel.homeostasis.stimulationPage,
            stimulationSnapshotHomeostasis: stimulationModel.homeostasis.stimulationSnapshot,
            stimulationFacetsHomeostasis: stimulationModel.homeostasis.stimulationFacets,
            stimulationDetailHomeostasis: stimulationModel.homeostasis.stimulationDetail,
            scheduledStimulations: scheduledStimulationModel.collections.scheduledStimulations,
            scheduledPages: scheduledStimulationModel.buckets.scheduledPage.scheduledStimulations,
            scheduledPageSummaries: scheduledStimulationModel.summaries.scheduledPage,
            scheduledPageHomeostasis: scheduledStimulationModel.homeostasis.scheduledPage,
            apps: topologyModel.summaries.apps,
            topology: topologyModel.summaries.topology,
            appsHomeostasis: topologyModel.homeostasis.apps,
            topologyHomeostasis: topologyModel.homeostasis.topology,
        },
        readExplorerQuery: () => CNSExplorerNavigation.queryOfHash(explorerAddress.readTracked()),
        dispose: () => {
            disposal.abort();
            schema.dispose();
            if (options.db === undefined) db.dispose();
        },
    };
}
