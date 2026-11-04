import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoMachineNodeOf } from '@exodra/core';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerAggregate } from '../../model/CNSExplorerAggregate';
import type { TCNSCollateralDispatch } from '../../types/TCNSCollateralDispatch';
import type { TCNSDiagramTarget } from '../../types/TCNSDiagramTarget';
import { dispatchMachine } from './dispatchMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { EMPTY_EXPLORER_TOPOLOGY } from '../../constants/EMPTY_EXPLORER_TOPOLOGY';
import { scheduledSectionMachine } from '../scheduled/scheduledSectionMachine';
import { scopeCardMachine } from './scopeCardMachine';
import { scopeDetailSchema } from './scopeDetailSchema';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const ScopeDetailPorts = scopeDetailSchema.ports;

const { setDispatch } = dispatchMachine.transitions;
const { setScope } = scopeCardMachine.transitions;

const collateralDetailBase = createExoMachine(scopeDetailSchema, {
    createInitialState: (c: TCNSDevToolsNode, name: string) => {
        c.one(ScopeDetailPorts.scheduled, scheduledSectionMachine, { filter: { collateralName: name }, where: 'on this collateral' });
        return {
            name,
            card: c.one(ScopeDetailPorts.card, scopeCardMachine),
            rows: c.keyedList(
                ScopeDetailPorts.rows,
                (dispatch: TCNSCollateralDispatch) => `${dispatch.stimulationId}:${dispatch.stage}:${dispatch.neuronName}`,
                dispatch => c.build(dispatchMachine, dispatch),
                setDispatch
            ),
        };
    },
});

function showCollateralDetail(c: TExoMachineNodeOf<typeof collateralDetailBase>): void {
    const { name, card, rows } = c.state;
    const query = CNSExplorerReads.queryOf(c);
    const detail = CNSExplorerAggregate.collateralDetail(name, CNSExplorerReads.topologyOf(c, query) ?? EMPTY_EXPLORER_TOPOLOGY, CNSExplorerReads.snapshotOf(c, query));
    setScope(card, {
        eyebrow: detail.isEntry ? 'COLLATERAL · ENTRY' : 'COLLATERAL · SCOPE',
        tone: 'cyan',
        title: name,
        description: detail.isEntry
            ? 'A COLLATERAL (cyan pill) — this one is an ENTRY collateral: no owning neuron, stimulations enter the graph here. The NEURONS on the right react to it. Click any neuron to open it.'
            : 'A COLLATERAL (cyan pill). It is emitted by its OWNER neuron (left) and reacted to by its SUBSCRIBER neurons (right, via their dendrites). Every side node is a neuron — click one to open it.',
        stat: detail.fires,
        statLabel: 'fires',
        isEntry: detail.isEntry,
        facts: [
            { label: 'owner', value: detail.isEntry ? 'entry' : '1', tone: detail.isEntry ? 'yellow' : 'green' },
            { label: 'subscribers', value: String(detail.subscribers.length), tone: 'violet' },
            { label: 'fires', value: String(detail.fires), tone: 'green' },
        ],
        diagram: {
            sourceKind: 'collateral',
            sourceLabel: name,
            leftHeading: 'OWNER NEURON ▸',
            rightHeading: '◂ SUBSCRIBER NEURONS (via dendrites)',
            left: detail.owner
                ? [{ id: detail.owner, kind: 'neuron', title: detail.owner, sub: 'owner · emits (axon)', weight: Math.max(1, detail.fires), status: 'completed', opens: { kind: 'neuron', id: detail.owner } }]
                : [],
            right: detail.subscribers.map((subscriber): TCNSDiagramTarget => ({
                id: subscriber.neuronName,
                kind: 'neuron',
                title: subscriber.neuronName,
                sub: subscriber.count > 0 ? `subscriber · ${subscriber.count}${subscriber.error ? ` · ${subscriber.error} err` : ''}` : 'subscriber · no traffic',
                weight: subscriber.count,
                status: subscriber.error > 0 ? 'failed' : subscriber.count > 0 ? 'completed' : 'idle',
                opens: { kind: 'neuron', id: subscriber.neuronName },
            })),
        },
    });
    c.attr(ScopeDetailPorts.headingTone, 'cyan');
    c.text(ScopeDetailPorts.heading, 'Dispatches');
    c.text(ScopeDetailPorts.caption, detail.dispatches.length ? `${detail.dispatches.length} recent emission${detail.dispatches.length === 1 ? '' : 's'} · payload · run · stage` : '');
    c.attr(ScopeDetailPorts.emptyHidden, detail.dispatches.length > 0);
    c.text(ScopeDetailPorts.empty, 'No dispatches of this collateral in the loaded snapshot yet.');
    rows.reconcile(detail.dispatches);
}

export const collateralDetailMachine = composeExoMachine(
    collateralDetailBase,
    m => withOIMEffects(m, effect => {
        effect(c => showCollateralDetail(c));
    })
);
