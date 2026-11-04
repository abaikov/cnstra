import { composeExoMachine, createExoMachine, withExoTransitions, withExoWire } from '@exodra/core';
import type { TExoAttrPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import { withCNSReceptors } from '@cnstra/exodra';
import { explorerUiAxon } from '../../model/axons/explorerUiAxon';
import type { TCNSDiagramLink } from '../../types/TCNSDiagramLink';
import { CNSNodeLinkLayout } from './CNSNodeLinkLayout';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const diagramLinkSchema = exoJsx<{
    kind: TExoAttrPort; status: TExoAttrPort; flowing: TExoAttrPort; edgePath: TExoAttrPort; edgeWidth: TExoAttrPort; edgeOpacity: TExoAttrPort; movingDotRadius: TExoAttrPort; stillDotRadius: TExoAttrPort; motionPath: TExoAttrPort; motionDuration: TExoAttrPort; dotX: TExoAttrPort; dotY: TExoAttrPort;
    nodeClass: TExoAttrPort; nodeTransform: TExoAttrPort; open: TExoEventPort; fullTitle: TExoTextPort; radius: TExoAttrPort; tag: TExoTextPort; titleY: TExoAttrPort; title: TExoTextPort; sub: TExoTextPort; glyph: TExoTextPort;
}>($ => (
    <g class="dg-link" data-kind={$.kind} data-status={$.status} data-flowing={$.flowing}>
        <path class="dg-edge" d={$.edgePath} stroke-width={$.edgeWidth} opacity={$.edgeOpacity} />
        <circle class="dg-dot dg-dot-moving" r={$.movingDotRadius}>
            <animateMotion path={$.motionPath} dur={$.motionDuration} repeatCount="indefinite" />
        </circle>
        <circle class="dg-dot dg-dot-still" r={$.stillDotRadius} cx={$.dotX} cy={$.dotY} />
        <g class={$.nodeClass} transform={$.nodeTransform} onClick={$.open}>
            <title>{$.fullTitle}</title>
            <rect class="dg-box" width={CNSNodeLinkLayout.NODE_WIDTH} height={CNSNodeLinkLayout.NODE_HEIGHT} rx={$.radius} />
            <text class="dg-tag" x="13" y="14">{$.tag}</text>
            <text class="dg-title" x="13" y={$.titleY}>{$.title}</text>
            <text class="dg-sub" x="13" y="39">{$.sub}</text>
            <text class="dg-glyph" x={CNSNodeLinkLayout.NODE_TRAILING_X} y="14" text-anchor="end">{$.glyph}</text>
            <text class="dg-open" x={CNSNodeLinkLayout.NODE_TRAILING_X} y="38" text-anchor="end">›</text>
        </g>
    </g>
));
const DiagramLinkPorts = diagramLinkSchema.ports;

type TCNSDiagramLinkState = { link: TCNSDiagramLink; shownMotion: string };

const diagramLinkBase = createExoMachine(diagramLinkSchema, {
    createInitialState: (_c: TCNSDevToolsNode, link: TCNSDiagramLink): TCNSDiagramLinkState => ({ link, shownMotion: '' }),
});

function showMotion(c: TExoMachineNodeOf<typeof diagramLinkBase>): void {
    const { link } = c.state;
    const duration = `${(2.4 - 1.4 * link.share).toFixed(2)}s`;
    const motion = `${link.edgePath} ${duration}`;
    if (motion === c.state.shownMotion) return;
    c.state.shownMotion = motion;
    c.attr(DiagramLinkPorts.motionPath, link.edgePath);
    c.attr(DiagramLinkPorts.motionDuration, duration);
}

function showLink(c: TExoMachineNodeOf<typeof diagramLinkBase>): void {
    const { link } = c.state;
    const { target, share } = link;
    const isFlowing = target.weight > 0;
    c.attr(DiagramLinkPorts.kind, target.kind);
    c.attr(DiagramLinkPorts.status, target.status);
    c.attr(DiagramLinkPorts.flowing, isFlowing);
    c.attr(DiagramLinkPorts.edgePath, link.edgePath);
    c.attr(DiagramLinkPorts.edgeWidth, isFlowing ? 1.4 + 2.6 * share : 1);
    c.attr(DiagramLinkPorts.edgeOpacity, isFlowing ? 0.4 + 0.5 * share : 0.4);
    const dotRadius = 2.6 + 1.4 * share;
    c.attr(DiagramLinkPorts.movingDotRadius, dotRadius);
    c.attr(DiagramLinkPorts.stillDotRadius, dotRadius);
    c.attr(DiagramLinkPorts.dotX, link.midX);
    c.attr(DiagramLinkPorts.dotY, link.midY);
    showMotion(c);
    c.attr(DiagramLinkPorts.nodeClass, target.opens === undefined ? 'dg-node' : 'dg-node dg-click');
    c.attr(DiagramLinkPorts.nodeTransform, link.nodeTransform);
    c.text(DiagramLinkPorts.fullTitle, target.title);
    c.attr(DiagramLinkPorts.radius, CNSNodeLinkLayout.radiusOf(target.kind, CNSNodeLinkLayout.NODE_HEIGHT));
    c.text(DiagramLinkPorts.tag, CNSNodeLinkLayout.tagOf(target.kind));
    c.attr(DiagramLinkPorts.titleY, target.sub ? 26 : 29);
    c.text(DiagramLinkPorts.title, CNSNodeLinkLayout.truncate(target.title, 19));
    c.text(DiagramLinkPorts.sub, target.sub ?? '');
    c.text(DiagramLinkPorts.glyph, CNSNodeLinkLayout.glyphOf(target.status));
}

export const diagramLinkMachine = composeExoMachine(
    diagramLinkBase,
    m => withExoTransitions(m, {
        setLink: (c, link: TCNSDiagramLink) => {
            c.state.link = link;
            showLink(c);
        },
    }),
    m => withExoWire(m, c => showLink(c)),
    m => withCNSReceptors(m, receptor => {
        receptor(DiagramLinkPorts.open, explorerUiAxon.entityOpened, c => {
            const { opens } = c.state.link.target;
            return opens === undefined ? undefined : { entry: opens, fresh: false };
        });
    })
);
