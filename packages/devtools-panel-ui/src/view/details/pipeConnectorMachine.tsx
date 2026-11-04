import { composeExoMachine, createExoMachine, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoMachineNodeOf } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TCNSPipeConnector } from '../../types/TCNSPipeConnector';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const pipeConnectorSchema = exoJsx<{ status: TExoAttrPort; flowing: TExoAttrPort }>($ => (
    <div class="pipe-connector" data-status={$.status} data-flowing={$.flowing}>
        <svg class="pipe-connector-svg" viewBox="0 0 34 44">
            <path class="pipe-connector-path" d="M2 22 C 12 22 22 22 32 22" />
            <circle class="pipe-connector-dot pipe-connector-dot-moving" r="3">
                <animateMotion path="M2 22 C 12 22 22 22 32 22" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <circle class="pipe-connector-dot pipe-connector-dot-still" r="3" cx="17" cy="22" />
        </svg>
    </div>
));
const PipeConnectorPorts = pipeConnectorSchema.ports;

const pipeConnectorBase = createExoMachine(pipeConnectorSchema, { createInitialState: (_c: TCNSDevToolsNode, _params: TCNSPipeConnector) => null });

function showPipeConnector(c: TExoMachineNodeOf<typeof pipeConnectorBase>, connector: TCNSPipeConnector): void {
    c.attr(PipeConnectorPorts.status, connector.status);
    c.attr(PipeConnectorPorts.flowing, connector.isFlowing);
}

export const pipeConnectorMachine = composeExoMachine(
    pipeConnectorBase,
    m => withExoWire(m, (c, connector) => showPipeConnector(c, connector))
);
