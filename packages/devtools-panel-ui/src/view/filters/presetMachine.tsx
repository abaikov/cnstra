import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { withCNSReceptors } from '@cnstra/exodra';
import type { TCNSExplorerQuery } from '../../types/TCNSExplorerQuery';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSTimePreset } from '../../types/TCNSTimePreset';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import { TIME_PRESETS } from '../../constants/TIME_PRESETS';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const activePresetDurationMs = (query: TCNSExplorerQuery, nowMs: number): number | null => {
    if (query.since === undefined && query.until === undefined) return 0;
    if (query.since === undefined || query.until !== undefined) return null;
    const elapsedMs = nowMs - query.since;
    let bestDurationMs = TIME_PRESETS[0].durationMs;
    let bestDistanceMs = Infinity;
    for (const { durationMs } of TIME_PRESETS.slice(0, -1)) {
        const distanceMs = Math.abs(elapsedMs - durationMs);
        if (distanceMs < bestDistanceMs) {
            bestDistanceMs = distanceMs;
            bestDurationMs = durationMs;
        }
    }
    return bestDistanceMs <= bestDurationMs * 0.5 ? bestDurationMs : null;
};

const presetSchema = exoJsx<{ active: TExoAttrPort; label: TExoTextPort; select: TExoEventPort }>($ => (
    <button class="exp-toggle exp-preset" data-tone="pink" data-active={$.active} onClick={$.select}>{$.label}</button>
));
const PresetPorts = presetSchema.ports;

const presetBase = createExoMachine(presetSchema, { createInitialState: (_c: TCNSDevToolsNode, preset: TCNSTimePreset) => preset });

function showPreset(c: TExoMachineNodeOf<typeof presetBase>): void {
    c.text(PresetPorts.label, c.state.label);
    c.attr(PresetPorts.active, activePresetDurationMs(CNSExplorerReads.queryOf(c), Date.now()) === c.state.durationMs);
}

export const presetMachine = composeExoMachine(
    presetBase,
    m => withCNSReceptors(m, receptor => {
        receptor(PresetPorts.select, explorerUiAxon.queryPatched, c => ({ patch: { since: c.state.durationMs === 0 ? undefined : Date.now() - c.state.durationMs, until: undefined } }));
    }),
    m => withOIMEffects(m, effect => {
        effect(c => showPreset(c));
    })
);
