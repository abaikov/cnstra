import { composeExoMachine, createExoMachine, withExoHandlers, withExoTransitions } from '@exodra/core';
import type { TExoAttrPort, TExoChildrenPort, TExoEventPort, TExoMachineNodeOf, TExoTextPort } from '@exodra/core';
import { exoJsx } from '@exodra/jsx';
import type { TExoKeyedList } from '@exodra/list-reconcile';
import type { TCNSDiagramConfig } from '../../types/TCNSDiagramConfig';
import type { TCNSDiagramLink } from '../../types/TCNSDiagramLink';
import type { TCNSDiagramSide } from '../../types/TCNSDiagramSide';
import { CNSNodeLinkLayout } from './CNSNodeLinkLayout';
import { diagramLinkMachine } from './diagramLinkMachine';
import type { TCNSDevToolsNode } from '../../types/TCNSDevToolsNode';

const nodeLinkDiagramSchema = exoJsx<{
    viewBox: TExoAttrPort; height: TExoAttrPort; left: TExoChildrenPort; right: TExoChildrenPort;
    sourceKind: TExoAttrPort; sourceTransform: TExoAttrPort; sourceFullTitle: TExoTextPort; sourceRadius: TExoAttrPort; sourceTag: TExoTextPort; sourceTitle: TExoTextPort; leftHeading: TExoTextPort; rightHeading: TExoTextPort;
    leftPagerHidden: TExoAttrPort; leftPagerTransform: TExoAttrPort; leftPageLabel: TExoTextPort; leftPrevious: TExoEventPort; leftPreviousKey: TExoEventPort<KeyboardEvent>; leftNext: TExoEventPort; leftNextKey: TExoEventPort<KeyboardEvent>;
    rightPagerHidden: TExoAttrPort; rightPagerTransform: TExoAttrPort; rightPageLabel: TExoTextPort; rightPrevious: TExoEventPort; rightPreviousKey: TExoEventPort<KeyboardEvent>; rightNext: TExoEventPort; rightNextKey: TExoEventPort<KeyboardEvent>;
}>($ => (
    <svg class="dg-svg" viewBox={$.viewBox} height={$.height} preserveAspectRatio="xMidYMid meet">
        <g><$.left /></g>
        <g><$.right /></g>
        <g class="dg-node dg-source" data-kind={$.sourceKind} transform={$.sourceTransform}>
            <title>{$.sourceFullTitle}</title>
            <rect class="dg-box" width={CNSNodeLinkLayout.SOURCE_WIDTH} height={CNSNodeLinkLayout.SOURCE_HEIGHT} rx={$.sourceRadius} />
            <text class="dg-tag" x={CNSNodeLinkLayout.SOURCE_CENTER_X} y="14" text-anchor="middle">{$.sourceTag}</text>
            <text class="dg-title" x={CNSNodeLinkLayout.SOURCE_CENTER_X} y="32" text-anchor="middle">{$.sourceTitle}</text>
        </g>
        <text class="dg-heading" x={CNSNodeLinkLayout.MARGIN} y="15">{$.leftHeading}</text>
        <text class="dg-heading" x={CNSNodeLinkLayout.TRAILING_HEADING_X} y="15" text-anchor="end">{$.rightHeading}</text>
        <g class="dg-pager" data-side="left" hidden={$.leftPagerHidden} transform={$.leftPagerTransform}>
            <g class="dg-page-turn" role="button" tabindex="0" aria-label="Previous page" transform={CNSNodeLinkLayout.PREVIOUS_PAGE_TRANSFORM} onClick={$.leftPrevious} on:keydown={$.leftPreviousKey}>
                <rect class="dg-page-turn-box" width={CNSNodeLinkLayout.PAGE_TURN_WIDTH} height={CNSNodeLinkLayout.PAGE_TURN_HEIGHT} rx="4" />
                <text class="dg-page-turn-glyph" x={CNSNodeLinkLayout.PAGE_TURN_GLYPH_X} y="14" text-anchor="middle">▲</text>
            </g>
            <g class="dg-page-turn" role="button" tabindex="0" aria-label="Next page" transform={CNSNodeLinkLayout.NEXT_PAGE_TRANSFORM} onClick={$.leftNext} on:keydown={$.leftNextKey}>
                <rect class="dg-page-turn-box" width={CNSNodeLinkLayout.PAGE_TURN_WIDTH} height={CNSNodeLinkLayout.PAGE_TURN_HEIGHT} rx="4" />
                <text class="dg-page-turn-glyph" x={CNSNodeLinkLayout.PAGE_TURN_GLYPH_X} y="14" text-anchor="middle">▼</text>
            </g>
            <text class="dg-page-label" x="0" y={CNSNodeLinkLayout.PAGE_LABEL_Y}>{$.leftPageLabel}</text>
        </g>
        <g class="dg-pager" data-side="right" hidden={$.rightPagerHidden} transform={$.rightPagerTransform}>
            <g class="dg-page-turn" role="button" tabindex="0" aria-label="Previous page" transform={CNSNodeLinkLayout.PREVIOUS_PAGE_TRANSFORM} onClick={$.rightPrevious} on:keydown={$.rightPreviousKey}>
                <rect class="dg-page-turn-box" width={CNSNodeLinkLayout.PAGE_TURN_WIDTH} height={CNSNodeLinkLayout.PAGE_TURN_HEIGHT} rx="4" />
                <text class="dg-page-turn-glyph" x={CNSNodeLinkLayout.PAGE_TURN_GLYPH_X} y="14" text-anchor="middle">▲</text>
            </g>
            <g class="dg-page-turn" role="button" tabindex="0" aria-label="Next page" transform={CNSNodeLinkLayout.NEXT_PAGE_TRANSFORM} onClick={$.rightNext} on:keydown={$.rightNextKey}>
                <rect class="dg-page-turn-box" width={CNSNodeLinkLayout.PAGE_TURN_WIDTH} height={CNSNodeLinkLayout.PAGE_TURN_HEIGHT} rx="4" />
                <text class="dg-page-turn-glyph" x={CNSNodeLinkLayout.PAGE_TURN_GLYPH_X} y="14" text-anchor="middle">▼</text>
            </g>
            <text class="dg-page-label" x="0" y={CNSNodeLinkLayout.PAGE_LABEL_Y}>{$.rightPageLabel}</text>
        </g>
    </svg>
));
const NodeLinkDiagramPorts = nodeLinkDiagramSchema.ports;

const { setLink } = diagramLinkMachine.transitions;

type TCNSNodeLinkDiagramState = {
    left: TExoKeyedList<TCNSDiagramLink>;
    right: TExoKeyedList<TCNSDiagramLink>;
    config: TCNSDiagramConfig | undefined;
    leftPage: number;
    rightPage: number;
};

const linkKeyOf = (link: TCNSDiagramLink): string => link.target.id;

const entityKeyOf = (config: TCNSDiagramConfig): string => `${config.sourceKind}:${config.sourceLabel}`;

const isActivationKey = (event: KeyboardEvent): boolean => event.key === 'Enter' || event.key === ' ';

const nodeLinkDiagramBase = createExoMachine(nodeLinkDiagramSchema, {
    createInitialState: (c: TCNSDevToolsNode): TCNSNodeLinkDiagramState => ({
        left: c.keyedList(NodeLinkDiagramPorts.left, linkKeyOf, link => c.build(diagramLinkMachine, link), setLink),
        right: c.keyedList(NodeLinkDiagramPorts.right, linkKeyOf, link => c.build(diagramLinkMachine, link), setLink),
        config: undefined,
        leftPage: 0,
        rightPage: 0,
    }),
});

function showDiagram(c: TExoMachineNodeOf<typeof nodeLinkDiagramBase>, config: TCNSDiagramConfig): void {
    const height = CNSNodeLinkLayout.heightOf(config);
    const leftPage = Math.min(c.state.leftPage, CNSNodeLinkLayout.pageCountOf(config.left.length) - 1);
    const rightPage = Math.min(c.state.rightPage, CNSNodeLinkLayout.pageCountOf(config.right.length) - 1);
    c.state.leftPage = leftPage;
    c.state.rightPage = rightPage;
    c.attr(NodeLinkDiagramPorts.viewBox, `0 0 ${CNSNodeLinkLayout.WIDTH} ${height}`);
    c.attr(NodeLinkDiagramPorts.height, height);
    c.state.left.reconcile(CNSNodeLinkLayout.linksOf(config, 'left', leftPage, height));
    c.state.right.reconcile(CNSNodeLinkLayout.linksOf(config, 'right', rightPage, height));
    c.attr(NodeLinkDiagramPorts.sourceKind, config.sourceKind);
    c.attr(NodeLinkDiagramPorts.sourceTransform, CNSNodeLinkLayout.sourceTransformOf(height));
    c.text(NodeLinkDiagramPorts.sourceFullTitle, config.sourceLabel);
    c.attr(NodeLinkDiagramPorts.sourceRadius, CNSNodeLinkLayout.radiusOf(config.sourceKind, CNSNodeLinkLayout.SOURCE_HEIGHT));
    c.text(NodeLinkDiagramPorts.sourceTag, CNSNodeLinkLayout.tagOf(config.sourceKind));
    c.text(NodeLinkDiagramPorts.sourceTitle, CNSNodeLinkLayout.truncate(config.sourceLabel, 18));
    c.text(NodeLinkDiagramPorts.leftHeading, config.left.length ? config.leftHeading ?? '' : '');
    c.text(NodeLinkDiagramPorts.rightHeading, config.right.length ? config.rightHeading ?? '' : '');
    c.attr(NodeLinkDiagramPorts.leftPagerHidden, !CNSNodeLinkLayout.isPaged(config.left.length));
    c.attr(NodeLinkDiagramPorts.leftPagerTransform, CNSNodeLinkLayout.pagerTransformOf('left', height));
    c.text(NodeLinkDiagramPorts.leftPageLabel, CNSNodeLinkLayout.pageLabelOf(config.left.length, leftPage));
    c.attr(NodeLinkDiagramPorts.rightPagerHidden, !CNSNodeLinkLayout.isPaged(config.right.length));
    c.attr(NodeLinkDiagramPorts.rightPagerTransform, CNSNodeLinkLayout.pagerTransformOf('right', height));
    c.text(NodeLinkDiagramPorts.rightPageLabel, CNSNodeLinkLayout.pageLabelOf(config.right.length, rightPage));
}

export const nodeLinkDiagramMachine = composeExoMachine(
    nodeLinkDiagramBase,
    m => withExoTransitions(m, {
        setDiagram: (c, config: TCNSDiagramConfig) => {
            if (c.state.config === undefined || entityKeyOf(c.state.config) !== entityKeyOf(config)) {
                c.state.leftPage = 0;
                c.state.rightPage = 0;
            }
            c.state.config = config;
            showDiagram(c, config);
        },
        turnPage: (c, side: TCNSDiagramSide, step: number) => {
            const { config } = c.state;
            if (config === undefined) return;
            const pageCount = CNSNodeLinkLayout.pageCountOf(config[side].length);
            const page = side === 'left' ? c.state.leftPage : c.state.rightPage;
            const turned = (page + step + pageCount) % pageCount;
            if (side === 'left') c.state.leftPage = turned;
            else c.state.rightPage = turned;
            showDiagram(c, config);
        },
    }),
    m => {
        const { turnPage } = m.transitions;
        return withExoHandlers(m, on => {
            on(NodeLinkDiagramPorts.leftPrevious, c => turnPage(c, 'left', -1));
            on(NodeLinkDiagramPorts.leftNext, c => turnPage(c, 'left', 1));
            on(NodeLinkDiagramPorts.rightPrevious, c => turnPage(c, 'right', -1));
            on(NodeLinkDiagramPorts.rightNext, c => turnPage(c, 'right', 1));
            on(NodeLinkDiagramPorts.leftPreviousKey, (c, event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                turnPage(c, 'left', -1);
            });
            on(NodeLinkDiagramPorts.leftNextKey, (c, event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                turnPage(c, 'left', 1);
            });
            on(NodeLinkDiagramPorts.rightPreviousKey, (c, event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                turnPage(c, 'right', -1);
            });
            on(NodeLinkDiagramPorts.rightNextKey, (c, event) => {
                if (!isActivationKey(event)) return;
                event.preventDefault();
                turnPage(c, 'right', 1);
            });
        });
    }
);
