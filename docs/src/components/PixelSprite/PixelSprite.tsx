import React from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './PixelSprite.module.css';

type TPixelLayer = { rows: readonly string[]; top?: number; className?: string };

const CRANIUM = [
    '......#######s......',
    '....#hh########s....',
    '...#hh#######c##s...',
    '..#hh#######cc###s..',
    '.#hh########c#####s.',
    '.#h##########c####s.',
    '#h###########cc####s',
    '#h############c####s',
    '##oooooo####oooooo#s',
    '#oooooooo##oooooooos',
    '#oooroooo##oooorooos',
    '#ooooooo####ooooooos',
    '.#ooooo##..##ooooos.',
    '..######....#####s..',
    '...######..#####s...',
    '...#.#.#.##.#.#.s...',
];

const JAW = [
    '...#.#.#.##.#.#.s...',
    '...#############s...',
    '....###########s....',
    '.....#########s.....',
];

const WIRE = [
    '.................w........',
    '..................ww......',
    '....................w.....',
    '.....................w.g..',
    '.....................wggg.',
    '......................wg..',
];

const pathsOf = (rows: readonly string[], top: number): Map<string, string> => {
    const paths = new Map<string, string>();
    rows.forEach((row, index) => {
        const y = top + index;
        for (let x = 0; x < row.length; ) {
            const char = row[x];
            let end = x + 1;
            while (row[end] === char) end++;
            if (char !== '.') paths.set(char, `${paths.get(char) ?? ''}M${x} ${y}h${end - x}v1h${x - end}z`);
            x = end;
        }
    });
    return paths;
};

type TPixelSpriteProps = {
    layers: readonly TPixelLayer[];
    columns: number;
    rows: number;
    size: number;
    className?: string;
    x?: number;
    y?: number;
};

export default function PixelSprite({ layers, columns, rows, size, className, x, y }: TPixelSpriteProps): ReactNode {
    return (
        <svg
            className={className}
            x={x}
            y={y}
            width={size}
            height={(size * rows) / columns}
            viewBox={`0 0 ${columns} ${rows}`}
            shapeRendering="crispEdges"
            aria-hidden="true"
        >
            {layers.map((layer, index) => (
                <g key={index} className={layer.className}>
                    {Array.from(pathsOf(layer.rows, layer.top ?? 0)).map(([char, path]) => (
                        <path key={char} data-pixel={char} d={path} />
                    ))}
                </g>
            ))}
        </svg>
    );
}

type TPixelSkullProps = {
    size: number;
    wired?: boolean;
    chattering?: boolean;
    className?: string;
    x?: number;
    y?: number;
};

export function PixelSkull({ size, wired = false, chattering = false, className, x, y }: TPixelSkullProps): ReactNode {
    const layers: TPixelLayer[] = [
        { rows: CRANIUM },
        { rows: JAW, top: CRANIUM.length, className: chattering ? styles.jawChattering : styles.jaw },
    ];
    if (wired) layers.push({ rows: WIRE, top: CRANIUM.length - 2, className: styles.wire });
    return (
        <PixelSprite
            layers={layers}
            columns={wired ? WIRE[0].length : CRANIUM[0].length}
            rows={CRANIUM.length + JAW.length}
            size={size}
            className={clsx(styles.skull, className)}
            x={x}
            y={y}
        />
    );
}
