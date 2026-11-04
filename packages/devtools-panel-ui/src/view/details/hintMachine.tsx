import { createExoMachine } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const hintSchema = exoJsx(() => (
    <div class="exp-hint">
        <div class="exp-hint-body">
            <span class="exp-hint-glyph">🧬</span>
            <div class="exp-heading eyebrow" data-tone="violet">DETAILS</div>
            <div class="exp-hint-text">Select a row to inspect it here — its scope card, connections and live signal flow appear beside the list.</div>
        </div>
    </div>
));

export const hintMachine = createExoMachine<TCNSDevToolsNode>(hintSchema);
