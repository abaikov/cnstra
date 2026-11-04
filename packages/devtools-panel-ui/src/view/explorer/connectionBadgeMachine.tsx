import { composeExoMachine, createExoMachine } from '@exodra/core';
import type { TExoAttrPort, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withOIMEffects } from '@oimdb/exodra';
import { CNSExplorerReads } from '../reads/CNSExplorerReads';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const connectionBadgeSchema = exoJsx<{ tone: TExoAttrPort; label: TExoTextPort }>($ => (
    <div class="exp-connection">
        <span class="brand exp-connection-brand">🧠 CNStra</span>
        <span class="exp-tone-dot exp-connection-dot" data-tone={$.tone} />
        <span class="exp-connection-label">{$.label}</span>
    </div>
));
const ConnectionBadgePorts = connectionBadgeSchema.ports;

export const connectionBadgeMachine = composeExoMachine(
    createExoMachine<TCNSDevToolsNode>(connectionBadgeSchema),
    m => withOIMEffects(m, effect => {
        effect(c => {
            const connection = CNSExplorerReads.connectionOf(c);
            const appName = CNSExplorerReads.appNameOf(c);
            const status = connection?.status ?? 'connecting';
            const via = connection && connection.transportKind !== 'socket' ? ` · ${connection.transportKind}` : '';
            c.attr(ConnectionBadgePorts.tone, status === 'connected' ? 'green' : status === 'connecting' ? 'yellow' : 'red');
            c.text(ConnectionBadgePorts.label, status === 'connected' ? `${appName || 'Server Connected'}${via}` : status === 'connecting' ? `Connecting…${via}` : `Disconnected${via}`);
        });
    })
);
