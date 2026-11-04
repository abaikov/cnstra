import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoRefPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import { presetMachine } from './presetMachine';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { TIME_PRESETS } from '../../constants/TIME_PRESETS';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const twoDigitsOf = (value: number): string => String(value).padStart(2, '0');

const localInputOf = (timestampMs: number | undefined): string => {
    if (timestampMs === undefined) return '';
    const date = new Date(timestampMs);
    return `${date.getFullYear()}-${twoDigitsOf(date.getMonth() + 1)}-${twoDigitsOf(date.getDate())}T${twoDigitsOf(date.getHours())}:${twoDigitsOf(date.getMinutes())}`;
};

const timestampOfLocalInput = (value: string): number | undefined => {
    const timestampMs = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(timestampMs) ? timestampMs : undefined;
};

const timeRangeSchema = exoJsx<{
    presets: TExoChildrenPort; since: TExoRefPort<HTMLInputElement>; sinceValue: TExoAttrPort; sinceChanged: TExoEventPort;
    until: TExoRefPort<HTMLInputElement>; untilValue: TExoAttrPort; untilChanged: TExoEventPort; clearHidden: TExoAttrPort; clear: TExoEventPort;
}>($ => (
    <div class="exp-time-range">
        <div class="exp-time-range-head">
            <div class="exp-heading eyebrow" data-tone="pink">Time range</div>
            <div class="exp-time-range-presets"><$.presets /></div>
        </div>
        <div class="exp-time-range-inputs">
            <label class="date-label">
                <span>from</span>
                <input class="date-input" type="datetime-local" ref={$.since} value={$.sinceValue} onChange={$.sinceChanged} />
            </label>
            <label class="date-label">
                <span>to</span>
                <input class="date-input" type="datetime-local" ref={$.until} value={$.untilValue} onChange={$.untilChanged} />
            </label>
            <button class="exp-time-range-clear" title="Clear time range" hidden={$.clearHidden} onClick={$.clear}>✕ clear</button>
        </div>
    </div>
));
const TimeRangePorts = timeRangeSchema.ports;

export const timeRangeMachine = composeExoMachine(
    createExoMachine(timeRangeSchema, {
        createInitialState: (c: TCNSDevToolsNode) => {
            c.list(TimeRangePorts.presets, presetMachine, TIME_PRESETS);
            return null;
        },
    }),
    m => withCNSReceptors(m, receptor => {
        receptor(TimeRangePorts.sinceChanged, explorerUiAxon.queryPatched, c => ({ patch: { since: timestampOfLocalInput(c.portNode(TimeRangePorts.since).value) } }));
        receptor(TimeRangePorts.untilChanged, explorerUiAxon.queryPatched, c => ({ patch: { until: timestampOfLocalInput(c.portNode(TimeRangePorts.until).value) } }));
        receptor(TimeRangePorts.clear, explorerUiAxon.queryPatched, () => ({ patch: { since: undefined, until: undefined } }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const { since, until } = CNSExplorerReads.queryOf(c);
            c.attr(TimeRangePorts.sinceValue, localInputOf(since));
            c.attr(TimeRangePorts.untilValue, localInputOf(until));
            c.attr(TimeRangePorts.clearHidden, since === undefined && until === undefined);
        });
    })
);
