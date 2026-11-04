import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSStimulationRosterRow } from '@cnstra/persist-dto';
import { CNSTimeFormat } from '../../utils/CNSTimeFormat';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSListRow } from '../../types/TCNSListRow';
import type { TCNSStatusPillPorts } from '../../types/TCNSStatusPillPorts';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { CNSStatusPill } from '../../utils/CNSStatusPill';
import { CNSEntityOpening } from '../../utils/CNSEntityOpening';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const stimulationRowSchema = exoJsx<TCNSStatusPillPorts & { active: TExoAttrPort; status: TExoAttrPort; rowIndex: TExoAttrPort; open: TExoEventPort; title: TExoTextPort; subtitle: TExoTextPort; startedAt: TExoTextPort; hops: TExoTextPort }>($ => (
    <div class="exp-row list-row stimulation-row" data-active={$.active} data-status={$.status} style={$.rowIndex} onClick={$.open}>
        <div class="row-left">
            <div class="row-heading">
                <span class="row-title">{$.title}</span>
                <span class="row-sub">{$.subtitle}</span>
            </div>
        </div>
        <div class="row-right">
            <span class="row-note">{$.startedAt}</span>
            <div class="metric">
                <span class="metric-value">{$.hops}</span>
                <span class="metric-label">hops</span>
            </div>
            <span class="status-pill" data-status={$.pillStatus}>
                <span class="exp-status-dot" />
                <span>{$.pillText}</span>
            </span>
        </div>
    </div>
));
const StimulationRowPorts = stimulationRowSchema.ports;

const stimulationRowBase = createExoMachine(stimulationRowSchema, {
    createInitialState: (_c: TCNSDevToolsNode, row: TCNSListRow<string>) => ({ row }),
});

function showStimulation(c: TExoMachineNodeOf<typeof stimulationRowBase>, stimulation: TCNSStimulationRosterRow): void {
    c.attr(StimulationRowPorts.status, stimulation.status);
    c.text(StimulationRowPorts.title, stimulation.entry.collateralName);
    c.text(StimulationRowPorts.subtitle, stimulation.stimulationId);
    c.text(StimulationRowPorts.startedAt, CNSTimeFormat.timeOf(stimulation.startedAt));
    c.text(StimulationRowPorts.hops, stimulation.hopCount);
    CNSStatusPill.show(c, StimulationRowPorts, stimulation.status);
}

export const stimulationRowMachine = composeExoMachine(
    stimulationRowBase,
    m => withExoTransitions(m, {
        setRow: (c, row: TCNSListRow<string>) => {
            c.state.row = row;
            c.attr(StimulationRowPorts.rowIndex, `--row-index:${row.index}`);
        },
    }),
    m => withExoWire(m, c => c.attr(StimulationRowPorts.rowIndex, `--row-index:${c.state.row.index}`)),
    m => withCNSReceptors(m, receptor => {
        receptor(StimulationRowPorts.open, explorerUiAxon.entityOpened, c => CNSEntityOpening.of('stimulation', c.state.row.item, true));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => c.attr(StimulationRowPorts.active, CNSExplorerReads.queryOf(c).selected === c.state.row.item));
        effect(c => {
            const stimulation = CNSExplorerReads.stimulationOf(c, c.state.row.item);
            if (stimulation !== undefined) showStimulation(c, stimulation);
        });
    })
);
