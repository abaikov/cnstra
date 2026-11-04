import { CNS, collateral, neuron } from '@cnstra/core';
import type { ICNS, TCNSNeuron } from '@cnstra/types';
import { EXO_PORT_EVENT, composeExoMachine, composeExoPlugins, createExoMachine, createExoSchema, exoPorts, withExoHandlers, withExoWire } from '@exodra/core';
import { ExoDomBackend, createExoDelegatedEvents, withExoCompiler } from '@exodra/dom';
import type { TExoDomNode } from '@exodra/dom';
import { injectCNS, provideCNS, withCNSReceptors } from '../index';

type TAppNode = TExoDomNode & { readonly cns: ICNS<TCNSNeuron<any>> };

const clicked = collateral();
const added = collateral<{ title: string }>();

const createApp = (cnsName: string) => {
    const seen: string[] = [];
    const cns = new CNS([
        neuron({})
            .dendrite({ collateral: clicked, response: () => { seen.push(`${cnsName}:clicked`); } })
            .dendrite({ collateral: added, response: payload => { seen.push(`${cnsName}:added:${payload.title}`); } }),
    ]);
    return { cns, seen };
};

const Ports = exoPorts({ CLEAR: EXO_PORT_EVENT, ADD: EXO_PORT_EVENT, SKIP: EXO_PORT_EVENT });

const Schema = createExoSchema(Ports, b => {
    b.el('div', null, div => {
        div.el('button', { id: 'clear' }, button => { button.eventPort(Ports.CLEAR, 'click'); });
        div.el('button', { id: 'add' }, button => { button.eventPort(Ports.ADD, 'click'); });
        div.el('button', { id: 'skip' }, button => { button.eventPort(Ports.SKIP, 'click'); });
    });
});

const createScreen = (cns: ICNS<TCNSNeuron<any>>) => {
    document.body.innerHTML = '';
    const root = document.createElement('main');
    document.body.appendChild(root);
    const backend = composeExoPlugins(withExoCompiler(new ExoDomBackend()), {
        events: () => createExoDelegatedEvents(['click']),
        cns: () => cns,
    });
    const click = (id: string) => { root.querySelector<HTMLElement>(`#${id}`)?.click(); };
    return { backend, root, click };
};

describe('withCNSReceptors', () => {
    it('turns each event port into a signal of the node CNS, takes the payload from payloadOf, and sends nothing when payloadOf returns undefined', () => {
        const app = createApp('app');
        const machine = composeExoMachine(createExoMachine<TAppNode>(Schema), m => withCNSReceptors(m, receptor => {
            receptor(Ports.CLEAR, clicked);
            receptor(Ports.ADD, added, () => ({ title: 'milk' }));
            receptor(Ports.SKIP, added, () => undefined);
        }));
        const screen = createScreen(app.cns);
        const dispose = screen.backend.render(machine, screen.root);

        screen.click('clear');
        screen.click('add');
        screen.click('skip');

        expect(app.seen).toEqual(['app:clicked', 'app:added:milk']);
        dispose();
    });

    it('takes the CNS of provideCNS before the cns service of the node, also for a machine defined apart from the one that provides it', () => {
        const app = createApp('app');
        const admin = createApp('admin');
        const libraryMachine = composeExoMachine(createExoMachine<TAppNode>(Schema), m => withCNSReceptors(m, receptor => { receptor(Ports.CLEAR, clicked); }));
        const adminMachine = composeExoMachine(libraryMachine, m => withExoWire(m, node => { provideCNS(node, admin.cns); }));
        const screen = createScreen(app.cns);
        const dispose = screen.backend.render(adminMachine, screen.root);

        screen.click('clear');

        expect(admin.seen).toEqual(['admin:clicked']);
        expect(app.seen).toEqual([]);
        dispose();
    });

    it('throws an error naming both places when the cns service of the backend answers undefined and nothing above provides one', () => {
        const machine = composeExoMachine(createExoMachine<TAppNode>(Schema), m => withCNSReceptors(m, receptor => {
            receptor(Ports.CLEAR, clicked);
        }));
        const unregisteredCNS = undefined as unknown as ICNS<TCNSNeuron<any>>;
        const screen = createScreen(unregisteredCNS);
        const dispose = screen.backend.render(machine, screen.root);
        const errors: unknown[] = [];
        const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
        window.addEventListener('error', onError);

        screen.click('clear');

        window.removeEventListener('error', onError);
        expect(errors).toEqual([new Error('injectCNS: no CNS for this node: register `cns: () => cns` in composeExoPlugins, or call provideCNS(node, cns) in the wiring of a node above it.')]);
        dispose();
    });

    it('refuses a second handler on a port that already has one, in either order, when the machine is defined', () => {
        const handled = withExoHandlers(createExoMachine<TAppNode>(Schema), on => { on(Ports.CLEAR, () => undefined); });
        const received = withCNSReceptors(createExoMachine<TAppNode>(Schema), receptor => { receptor(Ports.CLEAR, clicked); });

        expect(() => withCNSReceptors(handled, receptor => { receptor(Ports.CLEAR, clicked); })).toThrow('already has a handler');
        expect(() => withExoHandlers(received, on => { on(Ports.CLEAR, () => undefined); })).toThrow('already has a handler');
        expect(() => withCNSReceptors(createExoMachine<TAppNode>(Schema), receptor => {
            receptor(Ports.ADD, clicked);
            receptor(Ports.ADD, clicked);
        })).toThrow('already has a handler');
    });

    it('gives a handler that stimulates on its own the same CNS the receptors use', () => {
        const app = createApp('app');
        const admin = createApp('admin');
        const machine = composeExoMachine(
            createExoMachine<TAppNode>(Schema),
            m => withExoWire(m, node => { provideCNS(node, admin.cns); }),
            m => withExoHandlers(m, on => { on(Ports.CLEAR, node => { injectCNS(node).stimulate(clicked.createSignal()); }); }),
        );
        const screen = createScreen(app.cns);
        const dispose = screen.backend.render(machine, screen.root);

        screen.click('clear');

        expect(admin.seen).toEqual(['admin:clicked']);
        expect(app.seen).toEqual([]);
        dispose();
    });

    it('refuses at compile time a node without the cns service, a payload the collateral does not take, payloadOf on a collateral without payload, a collateral with payload without payloadOf, and a field the event does not have', () => {
        const toggled = collateral<{ id: string; done: boolean }>();
        const submitted = collateral<void>();
        const refused = () => {
            // @ts-expect-error
            withCNSReceptors(createExoMachine<TExoDomNode>(Schema), () => undefined);
            withCNSReceptors(createExoMachine<TAppNode>(Schema), receptor => {
                // @ts-expect-error
                receptor(Ports.CLEAR, toggled, () => ({ id: 'x' }));
                // @ts-expect-error
                receptor(Ports.ADD, clicked, () => undefined);
                // @ts-expect-error
                receptor(Ports.SKIP, added);
                // @ts-expect-error
                receptor(Ports.SKIP, submitted, () => undefined);
                receptor(Ports.ADD, added, (_node, event) => {
                    event.preventDefault();
                    // @ts-expect-error
                    return { title: event.notAnEventField };
                });
            });
        };

        expect(refused).toBeInstanceOf(Function);
    });
});
