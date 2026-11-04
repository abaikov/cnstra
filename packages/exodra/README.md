# @cnstra/exodra

```sh
npm install @cnstra/exodra @cnstra/core @cnstra/types @exodra/core @exodra/context
```

`@cnstra/types`, `@exodra/core` and `@exodra/context` are peer dependencies: one copy of each in the app.

The Exodra binding of CNStra: an event port of an Exodra machine becomes a signal of a CNS. The CNS is the `cns` service of the node, `cns: () => cns` in `composeExoPlugins`, unless `provideCNS` gave another one above it; a machine declares its receptors with `withCNSReceptors`, the same provide and inject pair the Exodra router has. Full guide, with OIMDB and the homeostat: [CNStra & Exodra](https://cnstra.org/docs/frontend/exodra).

```ts setup
import { CNS, collateral, neuron } from '@cnstra/core';
import { EXO_PORT_EVENT, composeExoMachine, createExoMachine, createExoSchema, exoPorts, withExoWire } from '@exodra/core';
import type { TExoMachineNode } from '@exodra/core';
import { provideCNS, withCNSReceptors } from '@cnstra/exodra';

const todoAdded = collateral<{ title: string }>();
const completedCleared = collateral();
const appCNS = new CNS([neuron({}).dendrite({ collateral: todoAdded, response: () => undefined })]);
const adminCNS = new CNS([neuron({}).dendrite({ collateral: todoAdded, response: () => undefined })]);
type TTodoNode = TExoMachineNode & { readonly cns: typeof appCNS };
const TodoPorts = exoPorts({ ADD: EXO_PORT_EVENT, CLEAR_COMPLETED: EXO_PORT_EVENT });
const TodoSchema = createExoSchema(TodoPorts, b => {
    b.el('button', null, button => { button.eventPort(TodoPorts.ADD, 'click'); });
    b.el('button', null, button => { button.eventPort(TodoPorts.CLEAR_COMPLETED, 'click'); });
});
```

```ts
export const todoMachine = composeExoMachine(
    createExoMachine<TTodoNode>(TodoSchema),
    m => withCNSReceptors(m, receptor => {
        receptor(TodoPorts.ADD, todoAdded, () => ({ title: 'milk' }));
        receptor(TodoPorts.CLEAR_COMPLETED, completedCleared);
    }),
);

export const adminTodoMachine = composeExoMachine(
    todoMachine,
    m => withExoWire(m, node => { provideCNS(node, adminCNS); }),
);
```

- **Which CNS.** The one `provideCNS` gave on the node or on an ancestor before that ancestor built the child, then the node's `cns` service. A machine whose node type has no `cns` does not compile; a backend that registers none throws on the event, with an error naming both places. One context token for the process, so a machine from a library sees the CNS the app provides — as long as the library lists `@cnstra/exodra` as a peer dependency, so the app has one copy of it.
- **No signal.** A `payloadOf` that returns `undefined` sends nothing, so it can drop an event or call `event.preventDefault()` before the signal goes; for the same reason a collateral cannot carry `undefined` as its payload through a receptor. The payload is checked against the collateral: a collateral without payload takes no `payloadOf`, and one with payload needs it.
- **One handler per port.** A receptor and a handler on the same port, in either order, throw when the machine is defined: receptors register through `withExoHandlers`, which refuses a second handler: «already has a handler» in development, `EXO0111` in production.
- **No result.** A receptor drops the stimulation it starts. A screen that must show a failure reads it from a slot the neuron writes, or stimulates from a handler.
- **Outside a receptor.** A handler that needs `stimulate` options, its returned stimulation or several signals calls `injectCNS(node)` and gets the same CNS, `provideCNS` included.
