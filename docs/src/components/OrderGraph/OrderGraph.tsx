import React from 'react';
import type { ReactNode } from 'react';
import styles from './OrderGraph.module.css';

export type TOrderNodeId = 'entry' | 'inventory' | 'payment' | 'mailer' | 'shipping';
export type TOrderNodeState = 'idle' | 'running' | 'done' | 'failed';
export type TOrderNodes = Record<TOrderNodeId, TOrderNodeState>;

export const IDLE_ORDER_NODES: TOrderNodes = {
    entry: 'idle',
    inventory: 'idle',
    payment: 'idle',
    mailer: 'idle',
    shipping: 'idle',
};

const NODES: { id: TOrderNodeId; label: string; x: number; y: number }[] = [
    { id: 'entry', label: 'orderPlaced', x: 10, y: 62 },
    { id: 'inventory', label: 'inventory', x: 150, y: 62 },
    { id: 'payment', label: 'payment', x: 290, y: 62 },
    { id: 'mailer', label: 'mailer', x: 430, y: 18 },
    { id: 'shipping', label: 'shipping', x: 430, y: 106 },
];

const EDGES: [TOrderNodeId, TOrderNodeId][] = [
    ['entry', 'inventory'],
    ['inventory', 'payment'],
    ['payment', 'mailer'],
    ['payment', 'shipping'],
];

const NODE_W = 112;
const NODE_H = 32;

const nodeById = (id: TOrderNodeId) => NODES.find(node => node.id === id)!;

export default function OrderGraph({ nodes, badges }: { nodes: TOrderNodes; badges?: Partial<Record<TOrderNodeId, string>> }): ReactNode {
    return (
        <svg className={styles.graph} viewBox="0 0 552 156" role="img" aria-label="Neuron graph of the order flow">
            {EDGES.map(([from, to]) => {
                const a = nodeById(from);
                const b = nodeById(to);
                const x1 = a.x + NODE_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const mid = (x1 + x2) / 2;
                return (
                    <path
                        key={`${from}-${to}`}
                        className={styles[`edge_${nodes[to]}`]}
                        d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                    />
                );
            })}
            {NODES.map(node => (
                <g key={node.id} className={styles[`node_${nodes[node.id]}`]}>
                    <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={2} />
                    <text x={node.x + NODE_W / 2} y={node.y + NODE_H / 2 + 4} textAnchor="middle">
                        {node.label}
                    </text>
                    {badges?.[node.id] !== undefined && (
                        <text className={styles.badge} x={node.x + NODE_W - 4} y={node.y - 4} textAnchor="end">
                            {badges[node.id]}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}
