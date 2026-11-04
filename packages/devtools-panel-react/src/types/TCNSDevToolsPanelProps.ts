import type { CSSProperties } from 'react';
import type { TCNSDevToolsPanelMountOptions } from '@cnstra/devtools-panel-ui/embed';

export type TCNSDevToolsPanelProps = TCNSDevToolsPanelMountOptions & {
    readonly className?: string;
    readonly style?: CSSProperties;
};
