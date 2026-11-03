import type { ReactNode } from 'react';
import CodeBlock from '@theme-original/CodeBlock';
import type CodeBlockType from '@theme/CodeBlock';
import type { WrapperProps } from '@docusaurus/types';

type TProps = WrapperProps<typeof CodeBlockType>;

const SETUP_ROLE = /(^|\s)setup(\s|$)/;
const SHOWN_ROLE = /(^|\s)shown(\s|$)/;

export default function CodeBlockWrapper(props: TProps): ReactNode {
    if (props.metastring === undefined || !SETUP_ROLE.test(props.metastring) || SHOWN_ROLE.test(props.metastring)) return <CodeBlock {...props} />;
    return (
        <details className="cns-setup-block">
            <summary>Setup shared by the examples on this page</summary>
            <CodeBlock {...props} />
        </details>
    );
}
