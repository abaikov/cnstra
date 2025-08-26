import { Graphics } from 'pixi.js';
import { TCNSNodeStyle, TCNSEdgeStyle, CANVAS_BG } from './src/style/TCNSTheme';

function drawNode(g: Graphics, group?: string, active?: boolean) {
    const s = TCNSNodeStyle({ group, active });
    g.clear();
    g.blendMode = 'add';
    g.lineStyle(s.strokeWidth, Number(s.stroke.replace('#', '0x')), 1.0);
    g.beginFill(Number(s.fill.replace('#', '0x')), 1.0);
    g.drawCircle(0, 0, s.radius);
    g.endFill();
    g.lineStyle(1, Number(s.glow.replace('#', '0x')), 0.35);
    g.drawCircle(0, 0, s.radius + 4);
}

function drawEdge(
    g: Graphics,
    points: Array<{ x: number; y: number }>,
    group?: string,
    heat = 0,
    active?: boolean
) {
    const s = TCNSEdgeStyle({ group, heat, active });
    g.clear();
    g.blendMode = 'add';
    g.lineStyle(s.width, Number(s.color.replace('#', '0x')), s.alpha);
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    g.lineStyle(s.width + 4, Number(s.glow.replace('#', '0x')), 0.15);
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
}

/*
import { CNS } from '@cnstra/core';
import { MicrogliaTrace, AstrogliaMeta } from '@cnstra/glia';
import { CNSDevToolsPanel } from '@cnstra/devtools-panel';

export function createCNSWithNeonVisualization() {
    // Create CNS with tracing enabled
    const cns = new CNS(afferentAxon, neurons)
        .use(MicrogliaTrace('cns-devtools'));

    // Add metadata to neurons for better visualization
    cns.useFor(neuronA, AstrogliaMeta({ 
        label: 'Input Neuron', 
        group: 'input', 
        color: '#7fffd4', 
        layer: 0 
    }));

    cns.useFor(neuronB, AstrogliaMeta({ 
        label: 'Process Neuron', 
        group: 'compute', 
        color: '#ff7f7f', 
        layer: 1 
    }));

    cns.useFor(neuronC, AstrogliaMeta({ 
        label: 'Output Neuron', 
        group: 'output', 
        color: '#7f7fff', 
        layer: 2 
    }));

    // Create and mount devtools panel with neon styles
    const panel = new CNSDevToolsPanel({
        channelName: 'cns-devtools',
        width: 1200,
        height: 800
    });

    document.body.appendChild(panel.render());

    // Now when you stimulate the network, you'll see live neon visualization!
    cns.stimulate('input', { data: 42 });

    return { cns, panel };
}
*/
