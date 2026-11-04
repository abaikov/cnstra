import type { TCNSDiagramConfig } from '../../types/TCNSDiagramConfig';
import type { TCNSDiagramLink } from '../../types/TCNSDiagramLink';
import type { TCNSDiagramNodeKind } from '../../types/TCNSDiagramNodeKind';
import type { TCNSDiagramSide } from '../../types/TCNSDiagramSide';
import type { TCNSDiagramStatus } from '../../types/TCNSDiagramStatus';

export class CNSNodeLinkLayout {
    static readonly WIDTH = 640;
    static readonly MARGIN = 8;
    static readonly NODE_WIDTH = 184;
    static readonly NODE_HEIGHT = 46;
    static readonly NODE_TRAILING_X = CNSNodeLinkLayout.NODE_WIDTH - 12;
    static readonly SOURCE_WIDTH = 158;
    static readonly SOURCE_HEIGHT = 52;
    static readonly SOURCE_CENTER_X = CNSNodeLinkLayout.SOURCE_WIDTH / 2;
    static readonly TRAILING_HEADING_X = CNSNodeLinkLayout.WIDTH - CNSNodeLinkLayout.MARGIN;
    private static readonly PAGE_SIZE = 8;
    private static readonly GAP = 12;
    private static readonly PAGER_HEIGHT = 26;
    private static readonly PAGE_SPAN = CNSNodeLinkLayout.PAGE_SIZE * CNSNodeLinkLayout.NODE_HEIGHT + (CNSNodeLinkLayout.PAGE_SIZE - 1) * CNSNodeLinkLayout.GAP;
    static readonly PAGE_TURN_WIDTH = 36;
    static readonly PAGE_TURN_HEIGHT = 20;
    static readonly PAGE_TURN_GLYPH_X = CNSNodeLinkLayout.PAGE_TURN_WIDTH / 2;
    static readonly PREVIOUS_PAGE_TRANSFORM = `translate(${(CNSNodeLinkLayout.NODE_WIDTH - CNSNodeLinkLayout.PAGE_TURN_WIDTH) / 2} 2)`;
    static readonly NEXT_PAGE_TRANSFORM = `translate(${(CNSNodeLinkLayout.NODE_WIDTH - CNSNodeLinkLayout.PAGE_TURN_WIDTH) / 2} ${CNSNodeLinkLayout.PAGER_HEIGHT + CNSNodeLinkLayout.PAGE_SPAN + 2})`;
    static readonly PAGE_LABEL_Y = CNSNodeLinkLayout.PAGER_HEIGHT + CNSNodeLinkLayout.PAGE_SPAN + 16;

    static heightOf(config: TCNSDiagramConfig): number {
        const { PAGE_SIZE, NODE_HEIGHT, GAP, PAGER_HEIGHT } = CNSNodeLinkLayout;
        const rows = Math.max(Math.min(config.left.length, PAGE_SIZE), Math.min(config.right.length, PAGE_SIZE), 1);
        const pagerHeight = CNSNodeLinkLayout.isPaged(config.left.length) || CNSNodeLinkLayout.isPaged(config.right.length) ? 2 * PAGER_HEIGHT : 0;
        return Math.max(160, rows * (NODE_HEIGHT + GAP) + 44) + pagerHeight;
    }

    static isPaged(count: number): boolean {
        return count > CNSNodeLinkLayout.PAGE_SIZE;
    }

    static pageCountOf(count: number): number {
        return Math.max(1, Math.ceil(count / CNSNodeLinkLayout.PAGE_SIZE));
    }

    static pageLabelOf(count: number, page: number): string {
        const first = page * CNSNodeLinkLayout.PAGE_SIZE + 1;
        const last = Math.min(count, (page + 1) * CNSNodeLinkLayout.PAGE_SIZE);
        return `${first}–${last} of ${count}`;
    }

    static pagerTransformOf(side: TCNSDiagramSide, height: number): string {
        const { WIDTH, MARGIN, NODE_WIDTH, PAGE_SPAN, PAGER_HEIGHT } = CNSNodeLinkLayout;
        const columnX = side === 'left' ? MARGIN : WIDTH - MARGIN - NODE_WIDTH;
        return `translate(${columnX} ${height / 2 - PAGE_SPAN / 2 - PAGER_HEIGHT})`;
    }

    static linksOf(config: TCNSDiagramConfig, side: TCNSDiagramSide, page: number, height: number): TCNSDiagramLink[] {
        const { WIDTH, NODE_WIDTH, NODE_HEIGHT, SOURCE_WIDTH, GAP, MARGIN, PAGE_SIZE } = CNSNodeLinkLayout;
        const maxWeight = Math.max(1, ...config.left.map(target => target.weight), ...config.right.map(target => target.weight));
        const targets = config[side].slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        const centerY = height / 2;
        const top = centerY - (targets.length * NODE_HEIGHT + (targets.length - 1) * GAP) / 2;
        const nodeX = side === 'left' ? MARGIN : WIDTH - MARGIN - NODE_WIDTH;
        const fromX = side === 'left' ? WIDTH / 2 - SOURCE_WIDTH / 2 : WIDTH / 2 + SOURCE_WIDTH / 2;
        const toX = side === 'left' ? MARGIN + NODE_WIDTH : WIDTH - MARGIN - NODE_WIDTH;
        const bend = (toX - fromX) * 0.5;
        return targets.map((target, i) => {
            const toY = top + i * (NODE_HEIGHT + GAP) + NODE_HEIGHT / 2;
            return {
                target,
                nodeTransform: `translate(${nodeX} ${toY - NODE_HEIGHT / 2})`,
                edgePath: `M ${fromX} ${centerY} C ${fromX + bend} ${centerY} ${toX - bend} ${toY} ${toX} ${toY}`,
                midX: (fromX + toX) / 2,
                midY: (centerY + toY) / 2,
                share: target.weight / maxWeight,
            };
        });
    }

    static sourceTransformOf(height: number): string {
        return `translate(${CNSNodeLinkLayout.WIDTH / 2 - CNSNodeLinkLayout.SOURCE_WIDTH / 2} ${height / 2 - CNSNodeLinkLayout.SOURCE_HEIGHT / 2})`;
    }

    static radiusOf(kind: TCNSDiagramNodeKind, height: number): number {
        return kind === 'collateral' ? height / 2 : 9;
    }

    static tagOf(kind: TCNSDiagramNodeKind): string {
        return kind === 'neuron' ? '▪ NEURON' : '◦ COLLATERAL';
    }

    static glyphOf(status: TCNSDiagramStatus): string {
        return status === 'failed' ? '🔒' : status === 'completed' ? '✓' : '·';
    }

    static truncate(text: string, length: number): string {
        if (text.length <= length) return text;
        return text.includes('.') ? '…' + text.slice(text.length - length + 1) : text.slice(0, length - 1) + '…';
    }
}
