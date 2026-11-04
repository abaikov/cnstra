import { useEffect, useRef } from 'react';
import type { TCNSDevToolsPanelProps } from './types/TCNSDevToolsPanelProps';

const PANEL_ELEMENT_STYLE = { height: '100%' };

export function CNSDevToolsPanel({ url, transport, isReadOnly, location, db, className, style }: TCNSDevToolsPanelProps) {
    const elementRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = elementRef.current;
        if (element === null) return undefined;
        let isCleanedUp = false;
        let unmount: (() => void) | undefined;
        import('@cnstra/devtools-panel-ui/embed')
            .then(({ mountCNSDevToolsPanel }) => {
                if (isCleanedUp) return;
                unmount = mountCNSDevToolsPanel(element, { url, transport, isReadOnly, location, db }).unmount;
            })
            .catch(error => {
                // eslint-disable-next-line no-console
                console.error('[CNStra devtools] the panel failed to load:', error);
            });
        return () => {
            isCleanedUp = true;
            unmount?.();
        };
    }, [url, transport, isReadOnly, location, db]);
    return (
        <div className={className} style={style}>
            <div ref={elementRef} style={PANEL_ELEMENT_STYLE} />
        </div>
    );
}
