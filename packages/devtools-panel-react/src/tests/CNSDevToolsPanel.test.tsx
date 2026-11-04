import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { mountCNSDevToolsPanel } from '@cnstra/devtools-panel-ui/embed';
import { CNSDevToolsPanel } from '../CNSDevToolsPanel';

const mockUnmount = jest.fn();

jest.mock('@cnstra/devtools-panel-ui/embed', () => ({ mountCNSDevToolsPanel: jest.fn(() => ({ unmount: mockUnmount })) }), { virtual: true });

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

describe('CNSDevToolsPanel', () => {
    it('mounts the panel into its inner div, remounts it when the url changes and unmounts it on cleanup', async () => {
        const mounted = jest.mocked(mountCNSDevToolsPanel);
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => root.render(<CNSDevToolsPanel url="/admin/cnstra" isReadOnly />));
        expect(mounted).toHaveBeenCalledTimes(1);
        expect(mounted).toHaveBeenLastCalledWith(container.firstChild?.firstChild, { url: '/admin/cnstra', transport: undefined, isReadOnly: true, location: undefined, db: undefined });
        expect(mockUnmount).not.toHaveBeenCalled();

        await act(async () => root.render(<CNSDevToolsPanel url="/admin/other" isReadOnly />));
        expect(mockUnmount).toHaveBeenCalledTimes(1);
        expect(mounted).toHaveBeenCalledTimes(2);
        expect(mounted).toHaveBeenLastCalledWith(container.firstChild?.firstChild, { url: '/admin/other', transport: undefined, isReadOnly: true, location: undefined, db: undefined });

        await act(async () => root.unmount());
        expect(mockUnmount).toHaveBeenCalledTimes(2);
        expect(mounted).toHaveBeenCalledTimes(2);
    });
});
