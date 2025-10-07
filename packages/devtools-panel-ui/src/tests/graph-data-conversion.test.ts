import { describe, it, expect, beforeEach } from '@jest/globals';

// Simple test data types
interface TestNeuron {
    id: string;
    appId: string;
    name: string;
}

interface TestDendrite {
    id: string;
    appId: string;
    neuronId: string;
    collateralName: string;
}

interface TestResponse {
    id: string;
    appId: string;
    stimulationId: string;
    timestamp: number;
    outputCollateralName?: string;
    inputCollateralName?: string;
    queueLength: number;
}

interface GraphNeuron {
    id: string;
    name: string;
    x: number;
    y: number;
    stimulationCount: number;
    stimulations: any[];
    type: 'input' | 'processing' | 'output';
}

// The conversion function from App.tsx (simplified)
function convertToGraphData(
    neurons: TestNeuron[],
    dendrites: TestDendrite[],
    responses: TestResponse[]
): { neurons: GraphNeuron[]; connections: any[] } {
    console.log('🔄 Converting test data...');
    console.log('  Input neurons:', neurons.length);
    console.log('  Input dendrites:', dendrites.length);
    console.log('  Input responses:', responses.length);

    if (!neurons || neurons.length === 0) {
        console.log('❌ No neurons to convert');
        return { neurons: [], connections: [] };
    }

    const graphNeurons: GraphNeuron[] = neurons.map((neuron, index) => {
        // Count stimulations for this neuron
        const neuronResponses = responses.filter(
            response =>
                response.outputCollateralName &&
                dendrites.some(
                    dendrite =>
                        dendrite.neuronId === neuron.id &&
                        dendrite.collateralName ===
                            response.outputCollateralName
                )
        );

        const graphNeuron = {
            id: neuron.id,
            name: neuron.name,
            x: 100 + index * 120,
            y: 200,
            stimulationCount: neuronResponses.length,
            stimulations: neuronResponses.map(response => ({
                id: response.id,
                timestamp: response.timestamp,
                signal: { type: 'test', intensity: 0.5 },
                targetNeuron: neuron.id,
            })),
            type: (index === 0
                ? 'input'
                : index === neurons.length - 1
                ? 'output'
                : 'processing') as 'input' | 'processing' | 'output',
        };

        console.log(
            `🧠 Neuron ${neuron.name}: ${neuronResponses.length} stimulations`
        );
        return graphNeuron;
    });

    console.log(
        '✅ Conversion complete:',
        graphNeurons.length,
        'graph neurons'
    );
    return { neurons: graphNeurons, connections: [] };
}

describe('Graph Data Conversion', () => {
    let testNeurons: TestNeuron[];
    let testDendrites: TestDendrite[];
    let testResponses: TestResponse[];

    beforeEach(() => {
        testNeurons = [
            { id: 'n1', appId: 'test-app', name: 'InputNeuron' },
            { id: 'n2', appId: 'test-app', name: 'ProcessorNeuron' },
            { id: 'n3', appId: 'test-app', name: 'OutputNeuron' },
        ];

        testDendrites = [
            {
                id: 'd1',
                appId: 'test-app',
                neuronId: 'n2',
                collateralName: 'userInput',
            },
            {
                id: 'd2',
                appId: 'test-app',
                neuronId: 'n3',
                collateralName: 'processed',
            },
        ];

        testResponses = [
            {
                id: 'r1',
                appId: 'test-app',
                stimulationId: 's1',
                timestamp: Date.now() - 3000,
                outputCollateralName: 'userInput',
                queueLength: 0,
            },
            {
                id: 'r2',
                appId: 'test-app',
                stimulationId: 's1',
                timestamp: Date.now() - 2000,
                outputCollateralName: 'processed',
                queueLength: 1,
            },
            {
                id: 'r3',
                appId: 'test-app',
                stimulationId: 's2',
                timestamp: Date.now() - 1000,
                outputCollateralName: 'userInput',
                queueLength: 0,
            },
        ];
    });

    it('should convert basic neuron data', () => {
        const result = convertToGraphData(
            testNeurons,
            testDendrites,
            testResponses
        );

        expect(result.neurons).toHaveLength(3);
        expect(result.neurons[0].name).toBe('InputNeuron');
        expect(result.neurons[0].type).toBe('input');
        expect(result.neurons[2].type).toBe('output');
    });

    it('should calculate correct stimulation counts', () => {
        const result = convertToGraphData(
            testNeurons,
            testDendrites,
            testResponses
        );

        // ProcessorNeuron (n2) should have 2 stimulations (userInput collateral)
        const processorNeuron = result.neurons.find(
            n => n.name === 'ProcessorNeuron'
        );
        expect(processorNeuron).toBeDefined();
        expect(processorNeuron!.stimulationCount).toBe(2);

        // OutputNeuron (n3) should have 1 stimulation (processed collateral)
        const outputNeuron = result.neurons.find(
            n => n.name === 'OutputNeuron'
        );
        expect(outputNeuron).toBeDefined();
        expect(outputNeuron!.stimulationCount).toBe(1);

        console.log('✅ Stimulation counts verified');
    });

    it('should handle empty data gracefully', () => {
        const result = convertToGraphData([], [], []);
        expect(result.neurons).toHaveLength(0);
        expect(result.connections).toHaveLength(0);
    });

    it('should handle neurons without stimulations', () => {
        const result = convertToGraphData(testNeurons, [], []); // No dendrites or responses

        expect(result.neurons).toHaveLength(3);
        result.neurons.forEach(neuron => {
            expect(neuron.stimulationCount).toBe(0);
            expect(neuron.stimulations).toHaveLength(0);
        });
    });

    it('should position neurons correctly', () => {
        const result = convertToGraphData(
            testNeurons,
            testDendrites,
            testResponses
        );

        // Check that neurons have different x positions
        const xPositions = result.neurons.map(n => n.x);
        const uniqueXPositions = new Set(xPositions);
        expect(uniqueXPositions.size).toBe(3); // All different positions

        // Check positions are reasonable
        result.neurons.forEach(neuron => {
            expect(neuron.x).toBeGreaterThan(0);
            expect(neuron.y).toBeGreaterThan(0);
        });
    });

    it('should handle high activity neurons', () => {
        // Create many responses for high activity
        const manyResponses: TestResponse[] = [];
        for (let i = 0; i < 50; i++) {
            manyResponses.push({
                id: `r${i}`,
                appId: 'test-app',
                stimulationId: `s${i}`,
                timestamp: Date.now() - i * 100,
                outputCollateralName: 'userInput',
                queueLength: 0,
            });
        }

        const result = convertToGraphData(
            testNeurons,
            testDendrites,
            manyResponses
        );

        const processorNeuron = result.neurons.find(
            n => n.name === 'ProcessorNeuron'
        );
        expect(processorNeuron!.stimulationCount).toBe(50);

        console.log(
            '🔥 High activity neuron created with',
            processorNeuron!.stimulationCount,
            'stimulations'
        );
    });
});
