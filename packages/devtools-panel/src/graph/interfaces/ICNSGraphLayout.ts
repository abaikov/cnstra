import { TCNSGraphNode, TCNSGraphEdge, TCNSLayoutResult } from '../layout';

export interface ICNSGraphLayout {
    computeLayout(
        nodes: TCNSGraphNode[],
        edges: TCNSGraphEdge[]
    ): Promise<TCNSLayoutResult>;
}
