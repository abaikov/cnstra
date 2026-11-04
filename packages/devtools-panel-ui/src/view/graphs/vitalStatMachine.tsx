import { composeExoMachine, createExoMachine, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import type { TCNSVitalStat } from '../../types/TCNSVitalStat';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const vitalStatSchema = exoJsx<{ label: TExoTextPort; tone: TExoAttrPort; value: TExoTextPort }>($ => (
    <div class="exp-vital">
        <span class="exp-vital-label">{$.label}</span>
        <span class="exp-vital-value" data-tone={$.tone}>{$.value}</span>
    </div>
));
const VitalStatPorts = vitalStatSchema.ports;

const vitalStatBase = createExoMachine(vitalStatSchema, {
    createInitialState: (_c: TCNSDevToolsNode, stat: TCNSVitalStat) => stat,
});

export const vitalStatMachine = composeExoMachine(
    vitalStatBase,
    m => withExoWire(m, (c, stat) => {
        c.text(VitalStatPorts.label, stat.label);
        c.attr(VitalStatPorts.tone, stat.tone);
    }),
    m => withOIMEffects(m, effect => {
        effect(c => c.text(VitalStatPorts.value, c.state.valueOf(c)));
    })
);
