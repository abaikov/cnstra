import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSCollateralDispatch } from '../../types/TCNSCollateralDispatch';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { CNSPayloadPreview } from '../../utils/CNSPayloadPreview';
import { CNSTaskKey } from '../../utils/CNSTaskKey';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const dispatchSchema = exoJsx<{ tone: TExoAttrPort; stageTone: TExoAttrPort; stage: TExoTextPort; entryHidden: TExoAttrPort; neuronHidden: TExoAttrPort; neuron: TExoTextPort; openNeuron: TExoEventPort; stimulationTitle: TExoAttrPort; stimulationId: TExoTextPort; openStimulation: TExoEventPort; payload: TExoTextPort; errorHidden: TExoAttrPort; error: TExoTextPort }>($ => (
    <div class="exp-dispatch" data-tone={$.tone}>
        <div class="exp-dispatch-head">
            <span class="exp-tag" data-tone={$.stageTone}>{$.stage}</span>
            <span class="exp-detail-caption" hidden={$.entryHidden}>entry signal</span>
            <span class="exp-link exp-dispatch-neuron" hidden={$.neuronHidden} onClick={$.openNeuron}>{$.neuron}</span>
            <div class="exp-spacer" />
            <span class="exp-link exp-dispatch-stimulation" title={$.stimulationTitle} onClick={$.openStimulation}>{$.stimulationId}</span>
        </div>
        <code class="exp-dispatch-payload">{$.payload}</code>
        <div class="exp-dispatch-error" hidden={$.errorHidden}>{$.error}</div>
    </div>
));
const DispatchPorts = dispatchSchema.ports;

const dispatchBase = createExoMachine(dispatchSchema, { createInitialState: (_c: TCNSDevToolsNode, dispatch: TCNSCollateralDispatch) => ({ dispatch }) });

function showDispatch(c: TExoMachineNodeOf<typeof dispatchBase>): void {
    const { dispatch } = c.state;
    c.attr(DispatchPorts.tone, dispatch.error ? 'red' : dispatch.isEntry ? 'yellow' : 'green');
    c.attr(DispatchPorts.stageTone, dispatch.isEntry ? 'yellow' : 'green');
    c.text(DispatchPorts.stage, dispatch.isEntry ? 'entry' : `stage ${CNSTaskKey.stageOf(dispatch.stage)}`);
    c.attr(DispatchPorts.entryHidden, !dispatch.isEntry);
    c.attr(DispatchPorts.neuronHidden, dispatch.isEntry);
    c.text(DispatchPorts.neuron, `▪ ${dispatch.neuronName}`);
    c.attr(DispatchPorts.stimulationTitle, dispatch.stimulationId);
    c.text(DispatchPorts.stimulationId, `⚡ ${dispatch.stimulationId}`);
    c.text(DispatchPorts.payload, CNSPayloadPreview.textOf(dispatch.payload, 400, false));
    c.attr(DispatchPorts.errorHidden, !dispatch.error);
    c.text(DispatchPorts.error, `⌐ ${dispatch.error ?? ''}`);
}

export const dispatchMachine = composeExoMachine(
    dispatchBase,
    m => withExoTransitions(m, {
        setDispatch: (c, dispatch: TCNSCollateralDispatch) => {
            c.state.dispatch = dispatch;
            showDispatch(c);
        },
    }),
    m => withExoWire(m, c => showDispatch(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(DispatchPorts.openNeuron, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('neuron', c.state.dispatch.neuronName, false));
        receptor(DispatchPorts.openStimulation, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('stimulation', c.state.dispatch.stimulationId, false));
    })
);
