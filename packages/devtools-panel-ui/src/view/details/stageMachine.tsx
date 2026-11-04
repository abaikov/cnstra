import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire, wireExoNode } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSPipeConnector } from '../../types/TCNSPipeConnector';
import type { TCNSStage } from '../../types/TCNSStage';
import { pipeConnectorMachine } from './pipeConnectorMachine';
import { CNSTaskKey } from '../../utils/CNSTaskKey';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const stageSchema = exoJsx<{ connectorHidden: TExoAttrPort; connector: TExoChildrenPort; title: TExoAttrPort; tone: TExoAttrPort; open: TExoEventPort; number: TExoTextPort; name: TExoTextPort }>($ => (
    <div class="exp-stage-slot">
        <div hidden={$.connectorHidden}><$.connector /></div>
        <div class="exp-stage" title={$.title} data-tone={$.tone} onClick={$.open}>
            <div class="exp-stage-number">{$.number}</div>
            <div class="exp-stage-name">{$.name}</div>
        </div>
    </div>
));
const StagePorts = stageSchema.ports;

const connectorOf = (stage: TCNSStage): TCNSPipeConnector => ({ status: stage.task.status, isFlowing: true });

const stageBase = createExoMachine(stageSchema, {
    createInitialState: (c: TCNSDevToolsNode, stage: TCNSStage) => ({
        stage,
        connector: c.one(StagePorts.connector, pipeConnectorMachine, connectorOf(stage)),
    }),
});

function showStage(c: TExoMachineNodeOf<typeof stageBase>): void {
    const { task, isFirst } = c.state.stage;
    c.attr(StagePorts.connectorHidden, isFirst);
    c.attr(StagePorts.title, `Open activation task · ${task.neuronName}`);
    c.attr(StagePorts.tone, task.status === 'failed' ? 'red' : 'green');
    c.text(StagePorts.number, CNSTaskKey.stageOf(task.index));
    c.text(StagePorts.name, task.neuronName);
}

export const stageMachine = composeExoMachine(
    stageBase,
    m => withExoTransitions(m, {
        setStage: (c, stage: TCNSStage) => {
            c.state.stage = stage;
            wireExoNode(c.state.connector, pipeConnectorMachine, connectorOf(stage));
            showStage(c);
        },
    }),
    m => withExoWire(m, c => showStage(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(StagePorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('task', CNSTaskKey.of(c.state.stage.task), false));
    })
);
